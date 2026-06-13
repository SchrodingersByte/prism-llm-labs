"""
In-process circuit breaker for SDK wrapper mode.

Teams using the SDK without a gateway (no PRISM_GATEWAY_URL) route calls
directly to upstream providers. This module provides a local fast-path breaker
and fires a fire-and-forget advisory POST to Prism so the gateway's shared
Redis key is also set, making circuit state converge across all instances.
"""

from __future__ import annotations

import time
import threading
from typing import Dict, Optional

CB_THRESHOLD   = 5         # errors within window to open
CB_WINDOW_S    = 60        # 60-second error counting window
CB_OPEN_TTL_S  = 300       # 5 minutes open before auto-close (half-open probe)


class PrismCircuitOpenError(Exception):
    """Raised when the in-process circuit breaker is open for a provider."""

    def __init__(self, provider: str) -> None:
        super().__init__(
            f'Prism circuit open for provider "{provider}" — too many recent errors. '
            f"Retry after {CB_OPEN_TTL_S}s."
        )
        self.provider = provider


class _BreakerEntry:
    __slots__ = ("errors", "window_start", "opened_at")

    def __init__(self) -> None:
        self.errors:       int            = 0
        self.window_start: float          = time.monotonic()
        self.opened_at:    Optional[float] = None


_breakers: Dict[str, _BreakerEntry] = {}
_lock = threading.Lock()


def _entry_key(api_key: str, provider: str) -> str:
    return f"{api_key}:{provider}"


def is_circuit_open(api_key: str, provider: str) -> bool:
    """Returns True when the breaker is open (requests should be rejected)."""
    with _lock:
        entry = _breakers.get(_entry_key(api_key, provider))
        if not entry or entry.opened_at is None:
            return False
        if time.monotonic() - entry.opened_at >= CB_OPEN_TTL_S:
            entry.opened_at = None
            entry.errors    = 0
            return False
        return True


def record_provider_error(
    api_key:    str,
    provider:   str,
    ingest_url: str,
    error_type: str = "provider_error",
) -> None:
    """
    Record a provider error. Opens the breaker after CB_THRESHOLD errors within
    CB_WINDOW_S. When the breaker opens, fires an advisory POST to the Prism server
    so the gateway's Redis circuit-breaker key is also set.
    """
    now = time.monotonic()
    should_notify = False

    with _lock:
        key   = _entry_key(api_key, provider)
        entry = _breakers.get(key)
        if entry is None or now - entry.window_start > CB_WINDOW_S:
            entry = _BreakerEntry()
            _breakers[key] = entry

        entry.errors += 1

        if entry.errors >= CB_THRESHOLD and entry.opened_at is None:
            entry.opened_at = now
            should_notify   = True

    if should_notify:
        _fire_advisory(api_key, provider, ingest_url, error_type)


def reset_breaker(api_key: str, provider: str) -> None:
    """Reset the breaker on a successful call."""
    with _lock:
        entry = _breakers.get(_entry_key(api_key, provider))
        if entry:
            entry.errors    = 0
            entry.opened_at = None


def _fire_advisory(api_key: str, provider: str, ingest_url: str, error_type: str) -> None:
    """Fire-and-forget POST to /api/telemetry/errors so gateway Redis is also tripped."""
    import json
    import threading

    base_url = ingest_url.replace("/api/ingest", "")

    def _post() -> None:
        try:
            import httpx
            httpx.post(
                f"{base_url}/api/telemetry/errors",
                content=json.dumps({"apiKey": api_key, "provider": provider, "error_type": error_type}),
                headers={"Content-Type": "application/json"},
                timeout=3.0,
            )
        except Exception:
            pass  # Advisory only — never propagate

    threading.Thread(target=_post, daemon=True).start()
