import asyncio
import os
import time
import threading
import uuid
import warnings
from typing import Optional

from openai import AsyncOpenAI as _BaseAsyncOpenAI
from openai.resources.chat.completions import AsyncCompletions as _BaseAsyncCompletions

from prism._budget import BudgetChecker
from prism._tracker import EventTracker
from prism._client import _detect_git_context
from prism._utils import spawn_capture


class _AsyncStreamWrapper:
    """Wraps an OpenAI async stream to fire telemetry when the final usage chunk arrives."""

    def __init__(self, stream, on_complete):
        self._stream = stream
        self._on_complete = on_complete

    def __aiter__(self):
        return self._iterate()

    async def _iterate(self):
        last_usage = None
        last_model = None
        async for chunk in self._stream:
            usage = getattr(chunk, "usage", None)
            if usage is not None:
                last_usage = usage
            model = getattr(chunk, "model", None)
            if model:
                last_model = model
            yield chunk
        self._on_complete(last_usage, last_model)

    async def __aenter__(self):
        await self._stream.__aenter__()
        return self

    async def __aexit__(self, *args):
        return await self._stream.__aexit__(*args)

    def __getattr__(self, name):
        return getattr(self._stream, name)


class _PrismAsyncCompletions(_BaseAsyncCompletions):
    """Async subclass that overrides create() with budget + telemetry logic."""

    def __init__(self, client: _BaseAsyncOpenAI, tracker: EventTracker, budget: BudgetChecker,
                 project: str, team: str, env: str) -> None:
        super().__init__(client)
        self._prism_tracker = tracker
        self._prism_budget  = budget
        self._prism_project = project
        self._prism_team    = team
        self._prism_env     = env

    async def create(self, *args, tags: dict | None = None, **kwargs):
        if self._prism_budget:
            await asyncio.to_thread(self._prism_budget.check_or_raise)

        if kwargs.get("stream"):
            so = kwargs.get("stream_options") or {}
            so["include_usage"] = True
            kwargs["stream_options"] = so

        t0 = time.monotonic()
        response = await super().create(*args, **kwargs)
        latency_ms = int((time.monotonic() - t0) * 1000)

        if not self._prism_tracker:
            return response

        messages = kwargs.get("messages") or []

        if kwargs.get("stream"):
            tracker = self._prism_tracker
            project, team, env = self._prism_project, self._prism_team, self._prism_env

            def _on_complete(usage, model):
                if usage is None:
                    return

                class _Stub:
                    pass

                stub = _Stub()
                stub.usage = usage
                stub.model = model or ""
                stub.id    = ""
                stub.choices = []
                stub.content = []
                spawn_capture(
                    tracker.capture,
                    args=(stub, latency_ms, project, team, env, messages),
                    kwargs={"call_tags": tags},
                )

            return _AsyncStreamWrapper(response, _on_complete)

        spawn_capture(
            self._prism_tracker.capture,
            args=(response, latency_ms, self._prism_project, self._prism_team, self._prism_env, messages),
            kwargs={"call_tags": tags},
        )

        return response


class AsyncOpenAI(_BaseAsyncOpenAI):
    """Drop-in replacement for openai.AsyncOpenAI with Prism observability."""

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
        self._prism_project = project or os.environ.get("PRISM_PROJECT", "")
        self._prism_team    = team or os.environ.get("PRISM_TEAM", "")
        self._prism_env     = environment or os.environ.get("PRISM_ENVIRONMENT", "production")

        if mode == "gateway" and key:
            app_url = (
                os.environ.get("PRISM_APP_URL")
                or os.environ.get("NEXT_PUBLIC_APP_URL")
                or "https://useprism.dev"
            ).rstrip("/")
            kwargs["base_url"]        = kwargs.get("base_url") or f"{app_url}/api/gateway/openai"
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
            self.chat.completions = _PrismAsyncCompletions(
                self, tracker, budget,
                self._prism_project, self._prism_team, self._prism_env,
            )
        elif not key:
            warnings.warn(
                "PRISM_API_KEY not set — observability disabled. "
                "Set the env var or pass prism_key= to enable.",
                stacklevel=2,
            )
