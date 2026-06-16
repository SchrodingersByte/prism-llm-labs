"""
End-user feedback helper (PRD-3).

Send a thumbs / score / comment linked to a trace (and span/session) from
anywhere in your app — e.g. a 👍/👎 handler. When ``trace_id``/``span_id`` are
omitted they default from the active Prism trace context, so feedback lands on
the right call automatically inside a ``trace()`` block.

    from prism.feedback import send_feedback
    send_feedback(value=1, comment="spot on")                    # 👍 on current trace
    send_feedback(value=0, trace_id=tid, feature_tag="support")  # 👎 on a specific trace

Server: POST /api/feedback (authenticated by PRISM_API_KEY).
"""
from __future__ import annotations

import os
from typing import Any, Dict, Optional

import httpx

from prism.trace import get_current_trace

_DEFAULT_APP_URL = "https://prism-dip-dey-s-projects.vercel.app"


def _base_url(explicit: Optional[str]) -> str:
    url = (
        explicit
        or os.environ.get("PRISM_GATEWAY_URL")
        or os.environ.get("PRISM_APP_URL")
        or _DEFAULT_APP_URL
    )
    return url.rstrip("/")


def send_feedback(
    *,
    value: float,
    trace_id: Optional[str] = None,
    span_id: Optional[str] = None,
    session_id: Optional[str] = None,
    feature_tag: Optional[str] = None,
    comment: Optional[str] = None,
    source: Optional[str] = None,
    project_id: Optional[str] = None,
    api_key: Optional[str] = None,
    base_url: Optional[str] = None,
    timeout: float = 10.0,
) -> Dict[str, Any]:
    """Record end-user feedback. Returns ``{"ok": True, "recorded": n}``.

    Raises on a missing key or a non-2xx response (wrap in try/except if feedback
    must never affect your flow).
    """
    key = api_key or os.environ.get("PRISM_API_KEY")
    if not key:
        raise ValueError("Prism feedback: missing API key (set PRISM_API_KEY or pass api_key).")

    trace = get_current_trace()
    body: Dict[str, Any] = {
        "value": value,
        "trace_id": trace_id or (trace.trace_id if trace else None),
        "span_id": span_id or (trace.span_id if trace else None),
        "session_id": session_id,
        "feature_tag": feature_tag,
        "comment": comment,
        "source": source,
        "project_id": project_id,
    }
    body = {k: v for k, v in body.items() if v is not None}

    resp = httpx.post(
        f"{_base_url(base_url)}/api/feedback",
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
        json=body,
        timeout=timeout,
    )
    try:
        data = resp.json()
    except Exception:
        data = {}
    if resp.status_code >= 300:
        raise RuntimeError(f"Prism feedback failed ({resp.status_code}): {data.get('error', resp.text)}")
    return {"ok": True, "recorded": int(data.get("recorded", 1))}
