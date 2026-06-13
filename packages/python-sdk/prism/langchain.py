"""
prism.langchain — LangChain callback handler for Prism cost observability.

Usage::

    from prism.langchain import PrismCallbackHandler

    handler = PrismCallbackHandler(prism_key=os.environ["PRISM_API_KEY"], project="my-app")
    result  = chain.invoke({"input": "..."}, config={"callbacks": [handler]})

Optional dependency: langchain-core>=0.3
Install: pip install prism-llm-labs[langchain]
"""

from __future__ import annotations

import hashlib
import json
import time
import uuid
from typing import Any, Optional

import httpx

try:
    from langchain_core.callbacks import BaseCallbackHandler  # type: ignore
    from langchain_core.outputs import LLMResult              # type: ignore
except ImportError as e:  # pragma: no cover
    raise ImportError(
        "langchain-core is required for prism.langchain. "
        "Install it with: pip install prism-llm-labs[langchain]"
    ) from e

from prism._config   import get_ingest_url
from prism._pricing  import calculate_cost, normalize_model_name


def _infer_provider(model: str) -> str:
    m = model.lower()
    if m.startswith(("gpt", "o1", "o3")):  return "openai"
    if m.startswith("claude"):              return "anthropic"
    if m.startswith("gemini"):              return "google"
    return "unknown"


class PrismCallbackHandler(BaseCallbackHandler):
    """
    LangChain callback handler that sends LLM events to Prism.

    Attach to any chain, agent, or LLM:

        handler = PrismCallbackHandler(prism_key="prism_prod_...", project="search")
        chain.invoke(input, config={"callbacks": [handler]})
    """

    def __init__(
        self,
        prism_key:    str,
        project:      Optional[str] = None,
        team:         Optional[str] = None,
        environment:  str           = "production",
        ingest_url:   Optional[str] = None,
    ) -> None:
        super().__init__()
        self._key         = prism_key
        self._project     = project or ""
        self._team        = team or ""
        self._environment = environment
        self._ingest_url  = ingest_url or get_ingest_url()
        self._http        = httpx.Client(timeout=5.0)
        self._start_times: dict[str, float] = {}
        self._chain_names: dict[str, str]   = {}

    # ── LLM events ────────────────────────────────────────────────────────────

    def on_llm_start(
        self,
        serialized: dict[str, Any],
        prompts:    list[str],
        *,
        run_id: uuid.UUID,
        **kwargs: Any,
    ) -> None:
        self._start_times[str(run_id)] = time.monotonic()

    def on_llm_end(
        self,
        response: LLMResult,
        *,
        run_id: uuid.UUID,
        **kwargs: Any,
    ) -> None:
        rid     = str(run_id)
        start   = self._start_times.pop(rid, time.monotonic())
        latency = int((time.monotonic() - start) * 1000)

        llm_output   = response.llm_output or {}
        token_usage  = llm_output.get("token_usage") or llm_output.get("usage") or {}

        input_tokens  = token_usage.get("prompt_tokens")     or token_usage.get("input_tokens")     or 0
        output_tokens = token_usage.get("completion_tokens") or token_usage.get("output_tokens")    or 0
        cached_tokens = token_usage.get("cached_tokens")     or token_usage.get("cache_read_tokens") or 0
        raw_model     = llm_output.get("model_name") or llm_output.get("model") or "unknown"
        model         = normalize_model_name(raw_model)
        request_id    = llm_output.get("id") or ""
        provider      = _infer_provider(model)

        tags: dict[str, str] = {}
        if self._project:               tags["project"]    = self._project
        if self._team:                  tags["team"]       = self._team
        chain_name = self._chain_names.get(rid)
        if chain_name:                  tags["chain_name"] = chain_name

        event = {
            "event_id":      str(uuid.uuid4()),
            "timestamp":     __import__("datetime").datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S.%f")[:-3],
            "org_id":        "",
            "project_id":    self._project,
            "project_name":  self._project,
            "team_id":       self._team,
            "user_id":       "",
            "environment":   self._environment,
            "provider":      provider,
            "model":         model,
            "input_tokens":  input_tokens,
            "output_tokens": output_tokens,
            "cached_tokens": cached_tokens,
            "image_tokens":  0,
            "audio_tokens":  0,
            "text_tokens":   0,
            "modalities":    "text",
            "cost_usd":      calculate_cost(model, input_tokens, output_tokens, cached_tokens),
            "latency_ms":    latency,
            "status_code":   200,
            "request_id":    request_id,
            "tags":          tags,
        }
        self._ship(event)

    def on_llm_error(
        self,
        error:   BaseException,
        *,
        run_id:  uuid.UUID,
        **kwargs: Any,
    ) -> None:
        rid     = str(run_id)
        start   = self._start_times.pop(rid, time.monotonic())
        latency = int((time.monotonic() - start) * 1000)

        event = {
            "event_id":      str(uuid.uuid4()),
            "timestamp":     __import__("datetime").datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S.%f")[:-3],
            "org_id":        "",
            "project_id":    self._project,
            "project_name":  self._project,
            "team_id":       self._team,
            "user_id":       "",
            "environment":   self._environment,
            "provider":      "unknown",
            "model":         "unknown",
            "input_tokens":  0,
            "output_tokens": 0,
            "cached_tokens": 0,
            "image_tokens":  0,
            "audio_tokens":  0,
            "text_tokens":   0,
            "modalities":    "text",
            "cost_usd":      0.0,
            "latency_ms":    latency,
            "status_code":   500,
            "request_id":    "",
            "tags":          {"error": str(error)[:200]},
        }
        self._ship(event)

    # ── Chain events ──────────────────────────────────────────────────────────

    def on_chain_start(
        self,
        serialized: dict[str, Any],
        inputs:     dict[str, Any],
        *,
        run_id: uuid.UUID,
        **kwargs: Any,
    ) -> None:
        name = None
        if isinstance(serialized.get("id"), list):
            name = serialized["id"][-1] if serialized["id"] else None
        elif isinstance(serialized.get("name"), str):
            name = serialized["name"]
        if name:
            self._chain_names[str(run_id)] = name

    def on_chain_end(
        self,
        outputs: dict[str, Any],
        *,
        run_id: uuid.UUID,
        **kwargs: Any,
    ) -> None:
        self._chain_names.pop(str(run_id), None)

    # ── Internal ──────────────────────────────────────────────────────────────

    def _ship(self, event: dict[str, Any]) -> None:
        try:
            self._http.post(
                self._ingest_url,
                content=json.dumps({"events": [event]}),
                headers={
                    "Authorization": f"Bearer {self._key}",
                    "Content-Type":  "application/json",
                },
            )
        except Exception:
            pass  # Never propagate — observability must not break the caller
