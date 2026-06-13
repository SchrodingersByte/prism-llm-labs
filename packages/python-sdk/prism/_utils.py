import atexit
import os
import threading
from typing import Callable


def env(key: str, default: str = "") -> str:
    return os.environ.get(key, default)


def org_from_key(prism_key: str) -> str:
    """Extract org prefix from key format: prism_{env}_{org4chars}_{random32}"""
    parts = prism_key.split("_")
    return parts[2] if len(parts) >= 4 else ""


# ── Background capture thread registry ───────────────────────────────────────
# Threads are daemon so they never block a long-running server from exiting,
# but we join them at process exit so short scripts don't lose telemetry.

_pending_captures: list[threading.Thread] = []
_pending_lock = threading.Lock()


def _flush_pending_captures() -> None:
    """Wait up to 5 s for all in-flight capture threads to complete on exit."""
    with _pending_lock:
        threads = list(_pending_captures)
    for t in threads:
        t.join(timeout=5.0)


atexit.register(_flush_pending_captures)


def spawn_capture(target: Callable, args: tuple = (), kwargs: dict | None = None) -> None:
    """Start a daemon capture thread and register it for atexit flushing."""
    t = threading.Thread(target=target, args=args, kwargs=kwargs or {}, daemon=True)
    with _pending_lock:
        # Prune finished threads before appending to keep the list small
        _pending_captures[:] = [x for x in _pending_captures if x.is_alive()]
        _pending_captures.append(t)
    t.start()
