"""
PrismMCP — Python MCP server instrumentation.

Wraps tools/call, resources/read, and prompts/get on any Python MCP server
(FastMCP or low-level mcp.Server) with the same observability, cost tracking,
and circuit-breaker behaviour as the TypeScript @prism-llm-labs/mcp-sdk.

Usage (FastMCP):
    import asyncio
    from mcp.server.fastmcp import FastMCP
    from prism import PrismMCP

    mcp    = FastMCP("my-server")
    prism  = PrismMCP(project="customer-support", session_id=run_id)

    @mcp.tool()
    @prism.track_tool           # ← decorator: wrap after @mcp.tool()
    async def search_web(query: str) -> str:
        return await do_search(query)

    # Or context-manager style:
    @mcp.tool()
    async def lookup_db(id: str) -> dict:
        async with prism.wrap_tool("lookup_db", inputs={"id": id}) as ctx:
            result = await db.get(id)
            ctx.set_output(result)   # optional: captured if capture_outputs=True
        return result

Multi-server session (PrismSession):
    from prism import PrismSession

    session = PrismSession(prism_key="...", project="agent", session_budget_usd=2.00)
    search  = session.create_server(server_name="search")
    db      = session.create_server(server_name="database")
    # Both share the same session_id — appear together in /dashboard/sessions
"""

from __future__ import annotations

import asyncio
import functools
import inspect
import json
import os
import time
import uuid
import warnings
from contextlib import asynccontextmanager
from typing import Any, AsyncGenerator, Callable, Dict, List, Optional

import httpx

# ── Built-in tool cost catalog (mirrors packages/mcp-sdk/src/pricing.ts) ─────

_TOOL_COSTS: Dict[str, float] = {
    "pinecone_query":         0.000001,
    "pinecone_upsert":        0.000002,
    "weaviate_query":         0.0000008,
    "qdrant_search":          0.0000005,
    "lambda_invoke":          0.0000002,
    "s3_get_object":          0.0000004,
    "s3_put_object":          0.000005,
    "dynamodb_get_item":      0.00000025,
    "dynamodb_put_item":      0.00000125,
    "brave_search":           0.000003,
    "serper_search":          0.000001,
    "tavily_search":          0.000002,
    "exa_search":             0.000005,
    "e2b_run_code":           0.000014,
    "code_interpreter":       0.000014,
    "send_email":             0.000001,
}

_DEFAULT_REDACT_KEYS = {"password", "token", "key", "secret", "api_key", "authorization"}


def _lookup_tool_cost(name: str, overrides: Optional[Dict[str, float]] = None) -> float:
    all_costs = {**_TOOL_COSTS, **(overrides or {})}
    if name in all_costs:
        return all_costs[name]
    # Prefix match: "pinecone_*"
    matches = [
        (k, v) for k, v in all_costs.items()
        if k.endswith("*") and name.startswith(k[:-1])
    ]
    if matches:
        return sorted(matches, key=lambda x: -len(x[0]))[0][1]
    return 0.0


def _redact(obj: Any, keys: set) -> Any:
    if isinstance(obj, dict):
        return {
            k: "[REDACTED]" if any(r in k.lower() for r in keys) else _redact(v, keys)
            for k, v in obj.items()
        }
    if isinstance(obj, list):
        return [_redact(v, keys) for v in obj]
    return obj


def _safe_json(val: Any, redact_keys: set, max_len: int = 1000) -> str:
    try:
        s = json.dumps(_redact(val, redact_keys))
        return s[:max_len] + "…" if len(s) > max_len else s
    except Exception:
        return "[unserializable]"


def _org_from_key(key: str) -> str:
    parts = key.split("_")
    return parts[2] if len(parts) >= 4 else ""


def _default_ingest_url() -> str:
    base = os.environ.get("PRISM_APP_URL", "https://useprism.dev").rstrip("/")
    return f"{base}/api/mcp/ingest"


def _outcomes_url(ingest_url: str) -> str:
    # /api/mcp/ingest → /api/outcomes
    return ingest_url.replace("/api/mcp/ingest", "/api/outcomes")


# ── Named error types (exported — callers can catch by name) ──────────────────

class PrismSessionBudgetExceededError(Exception):
    def __init__(self, session_id: str, budget_usd: float, current_usd: float) -> None:
        super().__init__(
            f"[prism-mcp] Session budget ${budget_usd:.4f} exceeded "
            f"(current: ${current_usd:.4f}) for session {session_id}"
        )
        self.session_id  = session_id
        self.budget_usd  = budget_usd
        self.current_usd = current_usd


class PrismToolCallLimitError(Exception):
    def __init__(self, session_id: str, limit: int) -> None:
        super().__init__(
            f"[prism-mcp] Tool call limit {limit} reached for session {session_id}. "
            "Possible agent loop detected — tool call blocked."
        )
        self.session_id = session_id
        self.limit      = limit


# ── Session budget (Redis via Upstash HTTP REST) ───────────────────────────────

class _SessionBudget:
    def __init__(self, org_id: str) -> None:
        self._org_id = org_id
        self._url    = os.environ.get("UPSTASH_REDIS_REST_URL")
        self._token  = os.environ.get("UPSTASH_REDIS_REST_TOKEN")

    async def _get(self, http: httpx.AsyncClient, key: str) -> float:
        if not self._url or not self._token:
            return 0.0
        try:
            resp = await http.get(
                f"{self._url}/get/{key}",
                headers={"Authorization": f"Bearer {self._token}"},
            )
            data = resp.json()
            return float(data.get("result") or 0)
        except Exception:
            return 0.0

    async def check_or_raise(
        self,
        session_id: str,
        budget_usd: Optional[float],
        max_calls:  Optional[int],
    ) -> None:
        if not self._url or not self._token:
            return
        async with httpx.AsyncClient(timeout=2.0) as http:
            if budget_usd and budget_usd > 0:
                cost = await self._get(http, f"session:{self._org_id}:{session_id}:cost")
                if cost >= budget_usd:
                    raise PrismSessionBudgetExceededError(session_id, budget_usd, cost)
            if max_calls and max_calls > 0:
                calls = await self._get(http, f"session:{self._org_id}:{session_id}:tool_calls")
                if calls >= max_calls:
                    raise PrismToolCallLimitError(session_id, max_calls)


# ── Context handle returned by wrap_tool/wrap_resource/wrap_prompt ─────────────

class WrapContext:
    """
    Passed to the caller so they can optionally attach output for capture
    and report actual billing costs that override the catalog estimate.
    """

    def __init__(self) -> None:
        self._output: Any                        = None
        self._output_set: bool                   = False
        self._actual_cost_usd: Optional[float]   = None
        self._downstream_resource: Optional[str] = None

    def set_output(self, value: Any) -> None:
        self._output     = value
        self._output_set = True

    def report_actual_cost(self, usd: float) -> None:
        """
        Override the built-in catalog estimate with the real cost from the
        tool's billing data.

        Example (AWS Lambda):
            async with prism_mcp.wrap_tool("invoke_lambda") as ctx:
                resp = await lambda_client.invoke(FunctionName="fn", Payload=payload)
                billed_ms = resp["ResponseMetadata"]["HTTPHeaders"].get(
                    "x-amz-billed-duration-ms", "0")
                ctx.report_actual_cost(int(billed_ms) * 0.000016667 / 1000)
        """
        self._actual_cost_usd = usd

    def set_downstream_resource(self, resource: str) -> None:
        """
        Tag this tool call with the downstream resource it touches.
        Used to attribute costs to specific vector DB indexes in the Prism
        infra cost breakdown dashboard.

        Convention:
          - Pinecone: "pinecone:<index-name>"  e.g. "pinecone:product-embeddings"
          - Qdrant:   "qdrant:<collection>"    e.g. "qdrant:support-docs"
          - Generic:  provider name only       e.g. "weaviate", "redis"

        Example:
            async with prism_mcp.wrap_tool("vector_search") as ctx:
                index = await resolve_index(query)
                ctx.set_downstream_resource(f"pinecone:{index}")
                return await pinecone.query(index=index, vector=embedding)
        """
        self._downstream_resource = resource


# ── Backward-compat alias
_WrapContext = WrapContext


# ── Main class ────────────────────────────────────────────────────────────────

class PrismMCP:
    """
    Python MCP server instrumentation — drop-in wrapper for FastMCP / mcp.Server.

    All arguments are optional; sensible defaults are read from env vars.
    """

    def __init__(
        self,
        prism_key:                Optional[str]         = None,
        project:                  Optional[str]         = None,
        team:                     Optional[str]         = None,
        environment:              Optional[str]         = None,
        session_id:               Optional[str]         = None,
        server_name:              str                   = "mcp-server",
        ingest_url:               Optional[str]         = None,
        session_budget_usd:       Optional[float]       = None,
        max_tool_calls_per_session: Optional[int]       = None,
        capture_inputs:           bool                  = False,
        capture_outputs:          bool                  = False,
        redact_keys:              Optional[List[str]]   = None,
        cost_overrides:           Optional[Dict[str, float]] = None,
        auto_outcome:             bool                  = False,
    ) -> None:
        self._key          = prism_key or os.environ.get("PRISM_API_KEY", "")
        self._project      = project     or os.environ.get("PRISM_PROJECT", "")
        self._team         = team        or os.environ.get("PRISM_TEAM", "")
        self._env          = environment or os.environ.get("PRISM_ENVIRONMENT", "production")
        self._session_id   = session_id  or str(uuid.uuid4())
        self._server_name  = server_name
        self._ingest_url   = ingest_url  or _default_ingest_url()
        self._budget_usd   = session_budget_usd
        self._max_calls    = max_tool_calls_per_session
        self._cap_inputs   = capture_inputs
        self._cap_outputs  = capture_outputs
        self._redact_keys  = set(redact_keys or []) | _DEFAULT_REDACT_KEYS
        self._cost_overrides = cost_overrides or {}
        self._auto_outcome = auto_outcome
        self._call_count   = 0
        self._budget       = _SessionBudget(_org_from_key(self._key))
        self._http         = httpx.AsyncClient(timeout=5.0)

        if not self._key:
            warnings.warn(
                "[prism-mcp] PRISM_API_KEY not set — MCP observability disabled.",
                stacklevel=2,
            )

    @property
    def session_id(self) -> str:
        return self._session_id

    # ── Core internal wrapper ─────────────────────────────────────────────────

    @asynccontextmanager
    async def _wrap(
        self,
        primitive_type:      str,   # "tool" | "resource" | "prompt" | "sampling"
        name:                str,
        inputs:              Optional[Any] = None,
        llm_request_id:      str = "",
        downstream_resource: Optional[str] = None,
    ) -> AsyncGenerator["WrapContext", None]:
        # 1. Budget / loop guard
        await self._budget.check_or_raise(
            self._session_id, self._budget_usd, self._max_calls
        )

        tags: Dict[str, str] = {}
        if self._cap_inputs and inputs is not None:
            tags["tool_input"] = _safe_json(inputs, self._redact_keys)

        ctx       = WrapContext()
        if downstream_resource:
            ctx._downstream_resource = downstream_resource

        start     = time.monotonic()
        status    = "ok"
        error_msg = ""

        try:
            yield ctx
        except Exception as exc:
            status    = "error"
            error_msg = str(exc)
            raise
        finally:
            latency_ms = int((time.monotonic() - start) * 1000)
            self._call_count += 1

            if self._cap_outputs and ctx._output_set:
                tags["tool_output"] = _safe_json(ctx._output, self._redact_keys)

            estimated_cost = (
                _lookup_tool_cost(name, self._cost_overrides)
                if primitive_type == "tool" else 0.0
            )
            actual_cost = ctx._actual_cost_usd
            tool_cost   = actual_cost if actual_cost is not None else estimated_cost
            cost_status = "actual" if actual_cost is not None else "estimated"

            import datetime as _dt
            event = {
                "event_id":             str(uuid.uuid4()),
                "timestamp":            _dt.datetime.now(_dt.timezone.utc).strftime(
                    "%Y-%m-%d %H:%M:%S.%f"
                )[:-3],
                "session_id":           self._session_id,
                "org_id":               _org_from_key(self._key),
                "project_id":           self._project,
                "team_id":              self._team,
                "user_id":              "",
                "environment":          self._env,
                "mcp_server_name":      self._server_name,
                "tool_name":            name,
                "downstream_resource":  ctx._downstream_resource or "",
                "execution_latency_ms": latency_ms,
                "tool_cost_usd":        tool_cost,
                "cost_status":          cost_status,
                "status":               status,
                "error_message":        error_msg,
                "llm_request_id":       llm_request_id,
                "primitive_type":       primitive_type,
                "tags":                 tags,
            }
            asyncio.create_task(self._ship(event))

            # Auto-outcome: record session success on last call if no errors
            if self._auto_outcome and status == "ok":
                asyncio.create_task(self._ship_outcome(success=True))

    async def _ship(self, event: dict) -> None:
        try:
            await self._http.post(
                self._ingest_url,
                json={"events": [event]},
                headers={
                    "Authorization": f"Bearer {self._key}",
                    "Content-Type":  "application/json",
                },
            )
        except Exception as exc:
            warnings.warn(f"[prism-mcp] Failed to ship event: {exc}", stacklevel=1)

    async def _ship_outcome(
        self,
        success:   bool           = True,
        value_usd: Optional[float] = None,
    ) -> None:
        try:
            await self._http.post(
                _outcomes_url(self._ingest_url),
                json={
                    "feature_tag": self._project or "mcp_session",
                    "action_tag":  "session_completed",
                    "session_id":  self._session_id,
                    "success":     success,
                    "value_usd":   value_usd,
                },
                headers={
                    "Authorization": f"Bearer {self._key}",
                    "Content-Type":  "application/json",
                },
            )
        except Exception:
            pass

    # ── Public API: session outcome ───────────────────────────────────────────

    async def end_session(
        self,
        success:   bool           = True,
        value_usd: Optional[float] = None,
    ) -> None:
        """
        Record that the current session completed successfully (or failed).
        Appears in the Unit Economics dashboard as an outcome event.

        Call this explicitly when your agent flow finishes, or set
        auto_outcome=True in the constructor to fire it automatically.

        Args:
            success:   True if the session goal was achieved.
            value_usd: Optional business value of a successful outcome (e.g. revenue
                       per ticket resolved, cost per query answered).
        """
        await self._ship_outcome(success=success, value_usd=value_usd)

    # ── Public API: tools ─────────────────────────────────────────────────────

    @asynccontextmanager
    async def wrap_tool(
        self,
        name:                str,
        inputs:              Optional[Any] = None,
        downstream_resource: Optional[str] = None,
        llm_request_id:      str           = "",
    ) -> AsyncGenerator[WrapContext, None]:
        """Context manager for wrapping a tool call.

        Args:
            name:                Tool name shown in the dashboard.
            inputs:              Raw tool arguments (captured if capture_inputs=True).
            downstream_resource: Tag the downstream service this call touches,
                e.g. "pinecone:my-index" or "qdrant:support-docs". Can also be
                set dynamically inside the block via ctx.set_downstream_resource().
            llm_request_id:      ID of the LLM request that triggered this call —
                links tool calls to their parent LLM completion in session view.
        """
        async with self._wrap(
            "tool", name, inputs,
            llm_request_id=llm_request_id,
            downstream_resource=downstream_resource,
        ) as ctx:
            yield ctx

    @asynccontextmanager
    async def wrap_resource(
        self,
        uri:            str,
        inputs:         Optional[Any] = None,
        llm_request_id: str           = "",
    ) -> AsyncGenerator[WrapContext, None]:
        """Context manager for wrapping a resources/read call."""
        async with self._wrap("resource", uri, inputs, llm_request_id=llm_request_id) as ctx:
            yield ctx

    @asynccontextmanager
    async def wrap_prompt(
        self,
        name:           str,
        inputs:         Optional[Any] = None,
        llm_request_id: str           = "",
    ) -> AsyncGenerator[WrapContext, None]:
        """Context manager for wrapping a prompts/get call."""
        async with self._wrap("prompt", name, inputs, llm_request_id=llm_request_id) as ctx:
            yield ctx

    @asynccontextmanager
    async def wrap_sampling(
        self,
        model_hint:     str = "sampling",
        llm_request_id: str = "",
    ) -> AsyncGenerator[WrapContext, None]:
        """Context manager for wrapping a sampling/createMessage call."""
        async with self._wrap("sampling", model_hint, llm_request_id=llm_request_id) as ctx:
            yield ctx

    # ── Decorator API ─────────────────────────────────────────────────────────

    def track_tool(self, fn: Callable) -> Callable:
        """
        Decorator that wraps an async MCP tool handler.

        Usage:
            @mcp.tool()
            @prism.track_tool
            async def search_web(query: str) -> str:
                return await do_search(query)
        """
        tool_name = fn.__name__

        @functools.wraps(fn)
        async def wrapper(*args: Any, **kwargs: Any) -> Any:
            inputs = kwargs if self._cap_inputs else None
            async with self._wrap("tool", tool_name, inputs) as ctx:
                result = await fn(*args, **kwargs)
                if self._cap_outputs:
                    ctx.set_output(result)
                return result

        return wrapper

    def track_resource(self, fn: Callable) -> Callable:
        """Decorator that wraps an async MCP resource handler."""
        resource_name = fn.__name__

        @functools.wraps(fn)
        async def wrapper(*args: Any, **kwargs: Any) -> Any:
            async with self._wrap("resource", resource_name, None) as ctx:
                result = await fn(*args, **kwargs)
                if self._cap_outputs:
                    ctx.set_output(result)
                return result

        return wrapper

    def track_prompt(self, fn: Callable) -> Callable:
        """Decorator that wraps an async MCP prompt handler."""
        prompt_name = fn.__name__

        @functools.wraps(fn)
        async def wrapper(*args: Any, **kwargs: Any) -> Any:
            async with self._wrap("prompt", prompt_name, None) as ctx:
                result = await fn(*args, **kwargs)
                if self._cap_outputs:
                    ctx.set_output(result)
                return result

        return wrapper

    async def close(self) -> None:
        """Close the underlying HTTP client. Call on server shutdown."""
        await self._http.aclose()


# ── PrismSession — shared session context for multi-server agent runs ─────────

class PrismSession:
    """
    Shared session context for agent runs that span multiple MCP servers.

    Creates a single session_id that is automatically threaded through all
    PrismMCP instances created from this session, and can be passed to LLM
    SDK clients so every LLM call and every tool call appear together in
    /dashboard/sessions.

    Usage:
        from prism import PrismSession, OpenAI

        session = PrismSession(
            prism_key="prism_live_...",
            project="customer-support",
            session_budget_usd=2.00,
        )

        search_mcp = session.create_server(server_name="search")
        db_mcp     = session.create_server(server_name="database")

        # LLM client shares the same session_id
        openai = OpenAI(**session.to_llm_options())
    """

    def __init__(
        self,
        prism_key:               Optional[str]  = None,
        project:                 Optional[str]  = None,
        team:                    Optional[str]  = None,
        environment:             Optional[str]  = None,
        session_id:              Optional[str]  = None,
        session_budget_usd:      Optional[float] = None,
        max_tool_calls_per_session: Optional[int] = None,
        capture_inputs:          bool           = False,
        capture_outputs:         bool           = False,
        redact_keys:             Optional[List[str]] = None,
        ingest_url:              Optional[str]  = None,
    ) -> None:
        self._key         = prism_key   or os.environ.get("PRISM_API_KEY", "")
        self._project     = project     or os.environ.get("PRISM_PROJECT", "")
        self._team        = team        or os.environ.get("PRISM_TEAM", "")
        self._environment = environment or os.environ.get("PRISM_ENVIRONMENT", "production")
        self._session_id  = session_id  or str(uuid.uuid4())
        self._shared: Dict[str, Any] = {
            "session_budget_usd":       session_budget_usd,
            "max_tool_calls_per_session": max_tool_calls_per_session,
            "capture_inputs":           capture_inputs,
            "capture_outputs":          capture_outputs,
            "redact_keys":              redact_keys,
            "ingest_url":               ingest_url,
        }

        if not self._key:
            warnings.warn(
                "[prism-mcp] PrismSession: PRISM_API_KEY not set — observability disabled.",
                stacklevel=2,
            )

    @property
    def session_id(self) -> str:
        return self._session_id

    def create_server(
        self,
        server_name:   str           = "mcp-server",
        cost_overrides: Optional[Dict[str, float]] = None,
        auto_outcome:  bool          = False,
    ) -> PrismMCP:
        """
        Create a PrismMCP instance bound to this session.

        All servers share the same session_id, so their events appear
        together in the session timeline on /dashboard/sessions.

        Args:
            server_name:    Display name in the dashboard MCP breakdown.
            cost_overrides: Per-tool cost overrides for this server.
            auto_outcome:   Emit a session outcome event on successful tool calls.
        """
        return PrismMCP(
            prism_key=                 self._key,
            project=                   self._project,
            team=                      self._team,
            environment=               self._environment,
            session_id=                self._session_id,
            server_name=               server_name,
            ingest_url=                self._shared["ingest_url"],
            session_budget_usd=        self._shared["session_budget_usd"],
            max_tool_calls_per_session=self._shared["max_tool_calls_per_session"],
            capture_inputs=            self._shared["capture_inputs"],
            capture_outputs=           self._shared["capture_outputs"],
            redact_keys=               self._shared["redact_keys"],
            cost_overrides=            cost_overrides,
            auto_outcome=              auto_outcome,
        )

    def to_llm_options(self) -> Dict[str, Any]:
        """
        Returns keyword arguments to pass to Prism LLM clients so that LLM
        completions are linked to this session in /dashboard/sessions.

        Usage:
            from prism import OpenAI
            openai = OpenAI(**session.to_llm_options())
        """
        return {
            "prism_key":   self._key,
            "project":     self._project,
            "team":        self._team,
            "environment": self._environment,
            "session_id":  self._session_id,
        }
