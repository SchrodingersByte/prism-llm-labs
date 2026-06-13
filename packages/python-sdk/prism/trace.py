"""
prism.trace — Application-layer tracing for Prism.

Wrap any function in a trace() context to automatically link all LLM calls
inside it to the same trace_id, enabling hierarchical call-tree views in
the Trace Explorer dashboard.

Usage::

    from prism import trace

    # Decorator
    @trace("answer-question")
    async def answer(question: str) -> str:
        return await openai.chat.completions.create(...)

    # Context manager
    async with trace.span("retrieval-pipeline") as ctx:
        docs = await retriever.query(...)
        answer = await openai.chat.completions.create(...)

    # Explicit trace_id (continue an existing trace)
    @trace("followup", trace_id="abc123")
    async def followup(ctx):
        ...
"""

from __future__ import annotations

import asyncio
import functools
import os
import uuid
from contextlib import asynccontextmanager, contextmanager
from contextvars import ContextVar
from dataclasses import dataclass, field
from typing import Any, AsyncGenerator, Callable, Dict, Generator, Optional, TypeVar

F = TypeVar("F", bound=Callable[..., Any])


@dataclass
class TraceContext:
    trace_id:       str  = field(default_factory=lambda: uuid.uuid4().hex)
    span_id:        str  = field(default_factory=lambda: uuid.uuid4().hex)
    parent_span_id: str  = ""
    name:           str  = ""
    attributes:     Dict[str, Any] = field(default_factory=dict)


_current_trace: ContextVar[Optional[TraceContext]] = ContextVar("prism_trace", default=None)

# Computed once per process: git context + PRISM_ENVIRONMENT/PRISM_PROJECT env vars.
# _detect_git_context() already exists in prism/_client.py — reused here to avoid duplication.
_dev_ctx: Optional[Dict[str, Any]] = None


def _get_dev_ctx() -> Dict[str, Any]:
    global _dev_ctx
    if _dev_ctx is None:
        try:
            from prism._client import _detect_git_context  # reuse existing implementation
            git = _detect_git_context()
        except Exception:
            git = {}
        _dev_ctx = {**git}
        env = os.environ.get("PRISM_ENVIRONMENT")
        proj = os.environ.get("PRISM_PROJECT")
        if env:  _dev_ctx["prism_environment"] = env
        if proj: _dev_ctx["prism_project"]     = proj
    return _dev_ctx


def _build_attributes(
    downstream_resource: Optional[str],
    cost_center_code: Optional[str],
    extra: Dict[str, Any],
) -> Dict[str, Any]:
    attrs: Dict[str, Any] = {**_get_dev_ctx(), **extra}
    if downstream_resource: attrs["downstream_resource"] = downstream_resource
    if cost_center_code:    attrs["cost_center_code"]    = cost_center_code
    return attrs


def get_current_trace() -> Optional[TraceContext]:
    """Returns the active TraceContext, or None if not inside a trace() call."""
    return _current_trace.get()


class trace:
    """
    Decorator and context-manager for Prism application-layer tracing.

    All LLM SDK calls made inside the wrapped function automatically inherit
    the trace_id and parent_span_id, producing a full call hierarchy.
    Developer context (git branch/commit, PRISM_ENVIRONMENT, PRISM_PROJECT) is
    captured once per process and merged into the span's attributes automatically.

    Examples::

        # Async function decorator — basic
        @trace("search-pipeline")
        async def search(query: str) -> list:
            return await openai.chat.completions.create(...)

        # FinOps tagging: downstream resource + GL cost center
        @trace("vector-search", downstream_resource="pinecone:product-index",
               cost_center_code="ENGR-001")
        async def vector_search(query: str) -> list:
            return await pinecone.query(vector=..., top_k=10)

        # Context manager (explicit span)
        async with trace.span("retrieval") as ctx:
            print(ctx.trace_id)   # the current trace ID
            results = await vector_db.search(...)
    """

    def __new__(  # type: ignore[misc]
        cls,
        name: str,
        *,
        trace_id: Optional[str] = None,
        downstream_resource: Optional[str] = None,
        cost_center_code: Optional[str] = None,
        **extra_attrs: Any,
    ) -> "type[trace]":
        return cls._make_decorator(  # type: ignore[return-value]
            name,
            trace_id=trace_id,
            downstream_resource=downstream_resource,
            cost_center_code=cost_center_code,
            extra_attrs=extra_attrs,
        )

    @classmethod
    def _make_decorator(
        cls,
        name: str,
        *,
        trace_id: Optional[str] = None,
        downstream_resource: Optional[str] = None,
        cost_center_code: Optional[str] = None,
        extra_attrs: Optional[Dict[str, Any]] = None,
    ) -> Callable[[F], F]:
        attrs = _build_attributes(downstream_resource, cost_center_code, extra_attrs or {})

        def decorator(fn: F) -> F:
            if asyncio.iscoroutinefunction(fn):
                @functools.wraps(fn)
                async def async_wrapper(*args: Any, **kwargs: Any) -> Any:
                    parent = _current_trace.get()
                    ctx = TraceContext(
                        trace_id       = trace_id or (parent.trace_id if parent else uuid.uuid4().hex),
                        span_id        = uuid.uuid4().hex,
                        parent_span_id = parent.span_id if parent else "",
                        name           = name,
                        attributes     = attrs,
                    )
                    token = _current_trace.set(ctx)
                    try:
                        return await fn(*args, **kwargs)
                    finally:
                        _current_trace.reset(token)
                return async_wrapper  # type: ignore[return-value]
            else:
                @functools.wraps(fn)
                def sync_wrapper(*args: Any, **kwargs: Any) -> Any:
                    parent = _current_trace.get()
                    ctx = TraceContext(
                        trace_id       = trace_id or (parent.trace_id if parent else uuid.uuid4().hex),
                        span_id        = uuid.uuid4().hex,
                        parent_span_id = parent.span_id if parent else "",
                        name           = name,
                        attributes     = attrs,
                    )
                    token = _current_trace.set(ctx)
                    try:
                        return fn(*args, **kwargs)
                    finally:
                        _current_trace.reset(token)
                return sync_wrapper  # type: ignore[return-value]
        return decorator

    @staticmethod
    @asynccontextmanager
    async def span(
        name: str,
        *,
        trace_id: Optional[str] = None,
        downstream_resource: Optional[str] = None,
        cost_center_code: Optional[str] = None,
        **extra_attrs: Any,
    ) -> AsyncGenerator[TraceContext, None]:
        """Async context manager that creates a child span."""
        parent = _current_trace.get()
        ctx = TraceContext(
            trace_id       = trace_id or (parent.trace_id if parent else uuid.uuid4().hex),
            span_id        = uuid.uuid4().hex,
            parent_span_id = parent.span_id if parent else "",
            name           = name,
            attributes     = _build_attributes(downstream_resource, cost_center_code, extra_attrs),
        )
        token = _current_trace.set(ctx)
        try:
            yield ctx
        finally:
            _current_trace.reset(token)

    @staticmethod
    @contextmanager
    def sync_span(
        name: str,
        *,
        trace_id: Optional[str] = None,
        downstream_resource: Optional[str] = None,
        cost_center_code: Optional[str] = None,
        **extra_attrs: Any,
    ) -> Generator[TraceContext, None, None]:
        """Sync context manager that creates a child span."""
        parent = _current_trace.get()
        ctx = TraceContext(
            trace_id       = trace_id or (parent.trace_id if parent else uuid.uuid4().hex),
            span_id        = uuid.uuid4().hex,
            parent_span_id = parent.span_id if parent else "",
            name           = name,
            attributes     = _build_attributes(downstream_resource, cost_center_code, extra_attrs),
        )
        token = _current_trace.set(ctx)
        try:
            yield ctx
        finally:
            _current_trace.reset(token)
