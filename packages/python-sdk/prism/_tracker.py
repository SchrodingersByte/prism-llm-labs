import hashlib
import json
import uuid
import warnings
from datetime import datetime, timezone
from typing import Optional, List

import httpx

from prism._config import get_ingest_url
from prism._pricing import calculate_cost, normalize_model_name
from prism._utils import org_from_key
from prism.trace import get_current_trace


class EventTracker:
    def __init__(self, prism_key: str, default_tags: dict | None = None):
        self._key          = prism_key
        self._http         = httpx.Client(timeout=5.0)
        self._default_tags = default_tags or {}

    @staticmethod
    def _hash_system_prompt(messages: list) -> str:
        """Return first 12 hex chars of SHA-256 of the concatenated system messages."""
        if not messages:
            return ""
        parts = []
        for m in messages:
            if isinstance(m, dict):
                role    = m.get("role", "")
                content = m.get("content", "")
            else:
                role    = getattr(m, "role", "")
                content = getattr(m, "content", "") or ""
            if role == "system":
                parts.append(content if isinstance(content, str) else json.dumps(content))
        if not parts:
            return ""
        joined = "\n".join(parts)
        return hashlib.sha256(joined.encode()).hexdigest()[:12]

    @staticmethod
    def _detect_modalities(messages: list) -> str:
        mods: set = {"text"}
        for msg in messages:
            content = msg.get("content") if isinstance(msg, dict) else getattr(msg, "content", None)
            if isinstance(content, list):
                for block in content:
                    t = block.get("type") if isinstance(block, dict) else getattr(block, "type", None)
                    if t == "image_url":
                        mods.add("image")
                    elif t == "input_audio":
                        mods.add("audio")
                    elif t == "file":
                        mods.add("document")
        return ",".join(sorted(mods))

    def capture(
        self,
        response,
        latency_ms: int,
        project_id: str = "",
        team_id: str = "",
        environment: str = "production",
        messages: Optional[List] = None,
        call_tags: Optional[dict] = None,
    ) -> None:
        try:
            usage = getattr(response, "usage", None)
            model = normalize_model_name(getattr(response, "model", "") or "")
            if usage is None:
                warnings.warn(
                    "Prism: response.usage is None — skipping event capture. "
                    "For streaming calls, use gateway mode for telemetry.",
                    stacklevel=1,
                )
                return

            details = getattr(usage, "prompt_tokens_details", None)
            comp_details = getattr(usage, "completion_tokens_details", None)
            cached       = getattr(details, "cached_tokens", 0) or 0 if details else 0
            image_tokens = getattr(details, "image_tokens", 0) or 0 if details else 0
            audio_tokens = getattr(comp_details, "audio_tokens", 0) or 0 if comp_details else 0
            text_tokens  = getattr(details, "text_tokens", 0) or 0 if details else 0
            modalities   = self._detect_modalities(messages or [])

            # Detect tool calls — OpenAI: choices[0].message.tool_calls
            #                      Anthropic: content[type=tool_use]
            tags: dict = {**self._default_tags, **(call_tags or {})}

            # Auto-hash system prompt for lightweight prompt versioning
            if "system_prompt_hash" not in tags and messages:
                prompt_hash = self._hash_system_prompt(messages)
                if prompt_hash:
                    tags["system_prompt_hash"] = prompt_hash

            choices = getattr(response, "choices", None) or []
            if choices:
                msg = getattr(choices[0], "message", None)
                tool_calls = getattr(msg, "tool_calls", None) or []
            else:
                tool_calls = []
            if not tool_calls:
                # Anthropic format
                content = getattr(response, "content", None) or []
                tool_calls = [b for b in content if getattr(b, "type", None) == "tool_use"]
            if tool_calls:
                tags["tool_calls_count"] = str(len(tool_calls))
                names = []
                for tc in tool_calls:
                    name = (
                        getattr(tc, "name", None)
                        or getattr(getattr(tc, "function", None), "name", None)
                        or "unknown"
                    )
                    names.append(name)
                tags["tool_names"] = ",".join(names)

            trace_ctx = get_current_trace()
            event = {
                "event_id":      str(uuid.uuid4()),
                "timestamp":     datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S.%f")[:-3],
                "org_id":        org_from_key(self._key),
                "project_id":    project_id,
                "project_name":  project_id,
                "team_id":       team_id,
                "user_id":       "",
                "environment":   environment,
                "provider":      "openai",
                "model":         model,
                "input_tokens":  getattr(usage, "prompt_tokens", 0) or 0,
                "output_tokens": getattr(usage, "completion_tokens", 0) or 0,
                "cached_tokens": cached,
                "image_tokens":  image_tokens,
                "audio_tokens":  audio_tokens,
                "text_tokens":   text_tokens,
                "modalities":    modalities,
                "cost_usd":      calculate_cost(
                    model,
                    getattr(usage, "prompt_tokens", 0) or 0,
                    getattr(usage, "completion_tokens", 0) or 0,
                    cached,
                ),
                "latency_ms":    latency_ms,
                "status_code":   200,
                "request_id":    getattr(response, "id", "") or "",
                "tags":          tags,
                "trace_id":      trace_ctx.trace_id       if trace_ctx else "",
                "span_id":       trace_ctx.span_id        if trace_ctx else "",
                "parent_span_id": trace_ctx.parent_span_id if trace_ctx else "",
                "attributes":    json.dumps(trace_ctx.attributes)
                                 if trace_ctx and trace_ctx.attributes
                                 else "",
            }
            resp = self._http.post(
                get_ingest_url(),
                content=json.dumps({"events": [event]}),
                headers={
                    "Authorization": f"Bearer {self._key}",
                    "Content-Type":  "application/json",
                },
            )
            if resp.status_code == 402:
                try:
                    body = resp.json()
                    cap_id = body.get("cap_id", "")
                except Exception:
                    cap_id = ""
                warnings.warn(
                    f"Prism: Spend cap exceeded — events not recorded. "
                    f"{'Cap ID: ' + cap_id + '. ' if cap_id else ''}"
                    f"Increase the cap or switch to gateway mode (set PRISM_GATEWAY_URL).",
                    stacklevel=1,
                )
            elif resp.status_code == 403:
                try:
                    body = resp.json()
                    detail = body.get("message") or body.get("error", "")
                except Exception:
                    detail = ""
                warnings.warn(
                    f"Prism: Model blocked by org policy — events not recorded. "
                    f"{detail or 'Contact your admin to update model governance settings.'}",
                    stacklevel=1,
                )
            elif resp.status_code == 422:
                try:
                    msg = resp.json().get("message", "")
                except Exception:
                    msg = ""
                warnings.warn(
                    f"Prism: {msg or 'Events rejected — project requires git branch tracking. Set GITHUB_REF_NAME env var.'}",
                    stacklevel=1,
                )
        except Exception as e:
            # Never propagate — observability must never break the caller
            warnings.warn(f"Prism: failed to capture event: {e}", stacklevel=1)

    def capture_raw(
        self,
        response,
        latency_ms: int,
        project_id: str,
        team_id: str,
        environment: str,
        provider: str,
        input_tokens: int,
        output_tokens: int,
        cached_tokens: int,
        image_tokens: int = 0,
        audio_tokens: int = 0,
        text_tokens: int = 0,
        modalities: str = "text",
        call_tags: Optional[dict] = None,
    ) -> None:
        """Capture with explicit token counts — used by non-OpenAI provider wrappers."""
        try:
            model = normalize_model_name(getattr(response, "model", "") or "")
            event = {
                "event_id":      str(uuid.uuid4()),
                "timestamp":     datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S.%f")[:-3],
                "org_id":        org_from_key(self._key),
                "project_id":    project_id,
                "project_name":  project_id,
                "team_id":       team_id,
                "user_id":       "",
                "environment":   environment,
                "provider":      provider,
                "model":         model,
                "input_tokens":  input_tokens,
                "output_tokens": output_tokens,
                "cached_tokens": cached_tokens,
                "image_tokens":  image_tokens,
                "audio_tokens":  audio_tokens,
                "text_tokens":   text_tokens,
                "modalities":    modalities,
                "cost_usd":      calculate_cost(model, input_tokens, output_tokens, cached_tokens),
                "latency_ms":    latency_ms,
                "status_code":   200,
                "request_id":    getattr(response, "id", "") or "",
                "tags":          {**self._default_tags, **(call_tags or {})},
            }
            resp = self._http.post(
                get_ingest_url(),
                content=json.dumps({"events": [event]}),
                headers={
                    "Authorization": f"Bearer {self._key}",
                    "Content-Type":  "application/json",
                },
            )
            if resp.status_code == 402:
                try:
                    body = resp.json()
                    cap_id = body.get("cap_id", "")
                except Exception:
                    cap_id = ""
                warnings.warn(
                    f"Prism: Spend cap exceeded — events not recorded. "
                    f"{'Cap ID: ' + cap_id + '. ' if cap_id else ''}"
                    f"Increase the cap or switch to gateway mode (set PRISM_GATEWAY_URL).",
                    stacklevel=1,
                )
            elif resp.status_code == 403:
                try:
                    body = resp.json()
                    detail = body.get("message") or body.get("error", "")
                except Exception:
                    detail = ""
                warnings.warn(
                    f"Prism: Model blocked by org policy — events not recorded. "
                    f"{detail or 'Contact your admin to update model governance settings.'}",
                    stacklevel=1,
                )
            elif resp.status_code == 422:
                try:
                    msg = resp.json().get("message", "")
                except Exception:
                    msg = ""
                warnings.warn(
                    f"Prism: {msg or 'Events rejected — project requires git branch tracking. Set GITHUB_REF_NAME env var.'}",
                    stacklevel=1,
                )
        except Exception as e:
            warnings.warn(f"Prism: failed to capture event: {e}", stacklevel=1)

    def record_outcome(
        self,
        feature_tag:  str,
        action_tag:   str | None = None,
        session_id:   str | None = None,
        success:      bool       = True,
        value_usd:    float | None = None,
        metadata:     dict | None  = None,
        occurred_at:  str | None   = None,
    ) -> None:
        """
        Record that a feature or action produced a business outcome.

        Use after a completed (or failed) business event to enable actual
        cost-per-successful-action tracking in the Unit Economics dashboard.

        Example::

            tracker.record_outcome(
                feature_tag="customer-support",
                success=True,
                value_usd=3.00,
            )
        """
        try:
            outcomes_url = get_ingest_url().replace("/api/ingest", "/api/outcomes")
            payload: dict = {
                "feature_tag": feature_tag,
                "success":     success,
            }
            if action_tag  is not None: payload["action_tag"]  = action_tag
            if session_id  is not None: payload["session_id"]  = session_id
            if value_usd   is not None: payload["value_usd"]   = value_usd
            if metadata    is not None: payload["metadata"]    = metadata
            if occurred_at is not None: payload["occurred_at"] = occurred_at

            self._http.post(
                outcomes_url,
                content=json.dumps(payload),
                headers={
                    "Authorization": f"Bearer {self._key}",
                    "Content-Type":  "application/json",
                },
            )
        except Exception:
            pass  # Never propagate
