import os
import time
import threading
import uuid
import warnings
from typing import Optional

try:
    from anthropic import Anthropic as _BaseAnthropic
    from anthropic.resources.messages import Messages as _BaseMessages
except ImportError:
    raise ImportError(
        "anthropic package is required for PrismAnthropic. "
        "Install it with: pip install prism-llm-labs[anthropic]"
    )

from prism._budget import BudgetChecker
from prism._tracker import EventTracker
from prism._client import _detect_git_context
from prism._utils import spawn_capture


class _PrismMessages(_BaseMessages):
    """Subclass that instruments messages.create() for Anthropic."""

    def __init__(self, client, tracker: EventTracker, budget: BudgetChecker,
                 project: str, team: str, env: str) -> None:
        super().__init__(client)
        self._prism_tracker = tracker
        self._prism_budget  = budget
        self._prism_project = project
        self._prism_team    = team
        self._prism_env     = env

    def create(self, *args, tags: dict | None = None, **kwargs):
        if self._prism_budget:
            self._prism_budget.check_or_raise()

        t0 = time.monotonic()
        response = super().create(*args, **kwargs)
        latency_ms = int((time.monotonic() - t0) * 1000)

        if self._prism_tracker:
            usage         = getattr(response, "usage", None)
            input_tokens  = getattr(usage, "input_tokens",  0) or 0
            output_tokens = getattr(usage, "output_tokens", 0) or 0
            # Anthropic prompt-caching: cache_read_input_tokens + cache_creation_input_tokens
            cached_tokens = (
                (getattr(usage, "cache_read_input_tokens",    0) or 0)
                + (getattr(usage, "cache_creation_input_tokens", 0) or 0)
            )
            spawn_capture(
                self._prism_tracker.capture_raw,
                args=(
                    response, latency_ms,
                    self._prism_project, self._prism_team, self._prism_env,
                    "anthropic", input_tokens, output_tokens, cached_tokens,
                ),
                kwargs={"call_tags": tags},
            )

        return response


class PrismAnthropic(_BaseAnthropic):
    """Drop-in replacement for anthropic.Anthropic with Prism observability.

    Usage (SDK mode):
        client = PrismAnthropic(prism_key="prism_live_...")

    Usage (gateway mode):
        client = PrismAnthropic(prism_key="prism_live_...", mode="gateway")
    """

    def __init__(
        self,
        *args,
        prism_key: Optional[str] = None,
        project: Optional[str] = None,
        team: Optional[str] = None,
        environment: Optional[str] = None,
        session_id: Optional[str] = None,
        mode: str = "sdk",
        capture_payloads: str = "off",
        redact=None,
        **kwargs,
    ):
        key = prism_key or os.environ.get("PRISM_API_KEY")
        prism_project = project or os.environ.get("PRISM_PROJECT", "")
        prism_team    = team or os.environ.get("PRISM_TEAM", "")
        prism_env     = environment or os.environ.get("PRISM_ENVIRONMENT", "production")

        if mode == "gateway" and key:
            app_url = (
                os.environ.get("PRISM_APP_URL")
                or os.environ.get("NEXT_PUBLIC_APP_URL")
                or "https://useprism.dev"
            ).rstrip("/")
            kwargs["base_url"] = kwargs.get("base_url") or f"{app_url}/api/gateway/anthropic"
            kwargs["api_key"]  = key   # satisfies Anthropic client validation
            default_headers           = dict(kwargs.get("default_headers") or {})
            default_headers["x-prism-key"] = key
            kwargs["default_headers"] = default_headers

        super().__init__(*args, **kwargs)

        if key and mode != "gateway":
            git_ctx = _detect_git_context()
            sid = session_id or str(uuid.uuid4())
            default_tags = {**git_ctx, "session_id": sid}
            tracker = EventTracker(key, default_tags=default_tags, capture_payloads=capture_payloads, redact=redact)
            budget  = BudgetChecker(key)
            self.messages = _PrismMessages(
                self, tracker, budget, prism_project, prism_team, prism_env,
            )
        elif not key:
            warnings.warn(
                "PRISM_API_KEY not set — observability disabled. "
                "Set the env var or pass prism_key= to enable.",
                stacklevel=2,
            )
