"""
prism.middleware — Auto-tagging utilities for production feature attribution.

Usage with FastAPI:

    from prism.middleware import prism_feature, PrismMiddleware
    from fastapi import FastAPI

    app = FastAPI()
    app.add_middleware(PrismMiddleware)   # auto-infers feature from route path

    # OR — explicit per-route tag:
    @app.post("/api/summarize")
    @prism_feature("document-summarization")
    async def summarize(body: SummarizeRequest):
        ...

Usage with Flask:

    from prism.middleware import prism_feature
    import os

    @app.route("/api/chat", methods=["POST"])
    @prism_feature("chat-assistant")
    def chat():
        ...

The decorator sets the PRISM_FEATURE environment variable for the duration of the
request. The Prism SDK reads this variable automatically when building event tags.
"""

from __future__ import annotations

import functools
import os
import re
from contextvars import ContextVar
from typing import Any, Callable, Optional, TypeVar

F = TypeVar("F", bound=Callable[..., Any])

# Context variable so async handlers don't leak features across concurrent requests
_current_feature: ContextVar[Optional[str]] = ContextVar("prism_feature", default=None)


def get_current_feature() -> Optional[str]:
    """Returns the feature tag for the current request context."""
    return _current_feature.get()


def prism_feature(feature_name: str) -> Callable[[F], F]:
    """
    Decorator that tags an endpoint with a Prism feature name.

    Works with sync and async functions (FastAPI, Flask, plain callables).

    Example::

        @app.post("/api/chat")
        @prism_feature("chat-assistant")
        async def chat(body: ChatRequest):
            ...
    """
    def decorator(func: F) -> F:
        if _is_async(func):
            @functools.wraps(func)
            async def async_wrapper(*args: Any, **kwargs: Any) -> Any:
                token = _current_feature.set(feature_name)
                prev = os.environ.get("PRISM_FEATURE")
                os.environ["PRISM_FEATURE"] = feature_name
                try:
                    return await func(*args, **kwargs)
                finally:
                    _current_feature.reset(token)
                    if prev is None:
                        os.environ.pop("PRISM_FEATURE", None)
                    else:
                        os.environ["PRISM_FEATURE"] = prev
            return async_wrapper  # type: ignore[return-value]
        else:
            @functools.wraps(func)
            def sync_wrapper(*args: Any, **kwargs: Any) -> Any:
                token = _current_feature.set(feature_name)
                prev = os.environ.get("PRISM_FEATURE")
                os.environ["PRISM_FEATURE"] = feature_name
                try:
                    return func(*args, **kwargs)
                finally:
                    _current_feature.reset(token)
                    if prev is None:
                        os.environ.pop("PRISM_FEATURE", None)
                    else:
                        os.environ["PRISM_FEATURE"] = prev
            return sync_wrapper  # type: ignore[return-value]
    return decorator


def _infer_feature(path: str) -> Optional[str]:
    """
    Auto-infer a feature name from a URL path.
    /api/chat          → "chat"
    /api/v1/summarize  → "summarize"
    /api/search/docs   → "search"
    """
    match = re.match(r"/api/(?:v\d+/)?([^/?#]+)", path)
    return match.group(1) if match else None


def _is_async(func: Callable) -> bool:
    import asyncio
    return asyncio.iscoroutinefunction(func)


# ── FastAPI / Starlette ASGI middleware ───────────────────────────────────────

class PrismMiddleware:
    """
    ASGI middleware that auto-infers x-prism-feature from the request path.

    Add to a FastAPI / Starlette app::

        from prism.middleware import PrismMiddleware
        app.add_middleware(PrismMiddleware)

    Override with an explicit header if needed::

        # In any handler, set header before calling the LLM:
        os.environ["PRISM_FEATURE"] = "custom-name"
    """

    def __init__(self, app: Any, feature_map: Optional[dict[str, str]] = None) -> None:
        self.app = app
        self.feature_map: dict[str, str] = feature_map or {}

    async def __call__(self, scope: dict, receive: Any, send: Any) -> None:
        if scope.get("type") == "http":
            path: str = scope.get("path", "")

            feature: Optional[str] = None
            for prefix, name in self.feature_map.items():
                if path == prefix or path.startswith(prefix.rstrip("/") + "/"):
                    feature = name
                    break
            if feature is None:
                feature = _infer_feature(path)

            if feature:
                token = _current_feature.set(feature)
                prev = os.environ.get("PRISM_FEATURE")
                os.environ["PRISM_FEATURE"] = feature
                try:
                    await self.app(scope, receive, send)
                finally:
                    _current_feature.reset(token)
                    if prev is None:
                        os.environ.pop("PRISM_FEATURE", None)
                    else:
                        os.environ["PRISM_FEATURE"] = prev
                return

        await self.app(scope, receive, send)


# ── Typed call-site tagging helper ────────────────────────────────────────────

def prism_tags(
    feature:     str | None = None,
    action:      str | None = None,
    cost_center: str | None = None,
    project:     str | None = None,
    session_id:  str | None = None,
    **extra:     str,
) -> dict[str, str]:
    """
    Build a headers dict (or call-tags dict) from typed Prism attribution fields.

    Eliminates manual header string spelling errors and provides IDE autocomplete
    for the most common Prism attribution headers.

    Usage with OpenAI SDK::

        from openai import OpenAI
        from prism.middleware import prism_tags

        client = OpenAI()
        response = client.chat.completions.create(
            model="gpt-4o",
            messages=messages,
            extra_headers=prism_tags(feature="chat", action="message", cost_center="eng"),
        )

    Usage with tracker.capture()::

        tracker.capture(response, latency_ms, call_tags=prism_tags(feature="chat"))

    :param feature:      Feature bucket (Unit Economics → Cost by Feature).
    :param action:       Action label for cost-per-action tracking.
    :param cost_center:  Finance GL cost-center code for chargeback.
    :param project:      Prism project ID to route this call's cost.
    :param session_id:   Session ID for grouping multiple LLM calls.
    :param extra:        Extra keys — each becomes ``x-prism-<key>``.
    :returns:            ``dict[str, str]`` of Prism HTTP headers.
    """
    headers: dict[str, str] = {}
    if feature:      headers["x-prism-feature"]     = feature
    if action:       headers["x-prism-action"]      = action
    if cost_center:  headers["x-prism-cost-center"] = cost_center
    if project:      headers["x-prism-project"]     = project
    if session_id:   headers["x-prism-session-id"]  = session_id
    for k, v in extra.items():
        if v:
            headers[f"x-prism-{k}"] = v
    return headers
