import os
import time
import warnings
from datetime import datetime
from typing import Dict, Optional, Tuple

import httpx


class BudgetExceededError(Exception):
    """Raised when a hard budget cap is enforced and spend exceeds limit."""


# Module-level cache: key_prefix:month → (result_dict, monotonic_timestamp)
_CACHE: Dict[str, Tuple[dict, float]] = {}
_CACHE_TTL = 30.0  # seconds


def _cache_get(key: str) -> Optional[dict]:
    entry = _CACHE.get(key)
    if entry and time.monotonic() - entry[1] < _CACHE_TTL:
        return entry[0]
    _CACHE.pop(key, None)
    return None


def _cache_set(key: str, data: dict) -> None:
    _CACHE[key] = (data, time.monotonic())


class BudgetChecker:
    """
    Checks the current month's spend against the configured budget by calling
    /api/budget/check. The server resolves the project and org from the API key.
    Results cached for 30s to avoid per-call overhead.
    """

    def __init__(self, prism_key: str) -> None:
        self._prism_key = prism_key
        self._base_url  = os.environ.get("PRISM_APP_URL", "https://useprism.dev").rstrip("/")
        self._http      = httpx.Client(timeout=2.0)

    def check_or_raise(self) -> None:
        cache_key = f"{self._prism_key[:12]}:{datetime.now().strftime('%Y-%m')}"
        result    = _cache_get(cache_key)

        if result is None:
            result = self._fetch()
            if result is not None:
                _cache_set(cache_key, result)

        if result is not None and not result.get("allowed", True):
            spend = result.get("spend", 0)
            limit = result.get("limit", 0)
            raise BudgetExceededError(
                f"Monthly budget exceeded: ${spend:.4f} spent of ${limit:.4f} limit. "
                "Set a higher budget in the Prism dashboard or disable enforce_hard_cap."
            )

    def _fetch(self) -> Optional[dict]:
        try:
            resp = self._http.get(
                f"{self._base_url}/api/budget/check",
                headers={"Authorization": f"Bearer {self._prism_key}"},
            )
            if resp.status_code == 401:
                warnings.warn("Prism: invalid API key for budget check", stacklevel=3)
                return None
            if not resp.is_success:
                return None
            return resp.json()
        except Exception as exc:
            warnings.warn(f"Prism: budget check failed ({exc})", stacklevel=3)
            return None

    def close(self) -> None:
        self._http.close()
