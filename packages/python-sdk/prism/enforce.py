"""
prism.enforce — Python import interception hook.

Patches sys.meta_path to intercept imports of raw AI provider SDKs
and transparently substitute Prism-wrapped versions.

Usage:
    # Add to sitecustomize.py for process-wide enforcement:
    import prism.enforce

    # Or run a script with enforcement:
    python -c "import prism.enforce" && python app.py

    # Or as a one-liner:
    PYTHONPATH=. python -c "import prism.enforce; exec(open('app.py').read())"

Environment variables:
    PRISM_ENFORCE_MODE=transparent  (default) silently wraps
    PRISM_ENFORCE_MODE=warn         wraps + prints warning to stderr
    PRISM_ENFORCE_MODE=strict       raises PrismEnforceError

Only active when PRISM_API_KEY is set.
"""

from __future__ import annotations

import importlib
import importlib.abc
import importlib.machinery
import json
import os
import subprocess
import sys
import threading
import types
import urllib.request
import warnings
from typing import Optional, Sequence


class PrismEnforceError(ImportError):
    def __init__(self, module_name: str) -> None:
        super().__init__(
            f'[prism-enforce] Blocked import of raw SDK "{module_name}". '
            f"Use the Prism wrapper instead:\n"
            f"  from prism import OpenAI          (instead of: import openai)\n"
            f"  from prism import PrismAnthropic  (instead of: import anthropic)\n\n"
            f"To allow untracked imports, set PRISM_ENFORCE_MODE=warn or "
            f"remove the import prism.enforce call."
        )


# Mapping: raw module name → (prism_module, attr_name)
_INTERCEPT: dict[str, tuple[str, str]] = {
    "openai":          ("prism._client",           "OpenAI"),
    "anthropic":       ("prism._anthropic_client", "PrismAnthropic"),
    "google.generativeai": ("prism._google_client", "PrismGoogleAI"),
}

_MODE: str = os.environ.get("PRISM_ENFORCE_MODE", "transparent")
_ACTIVE: bool = bool(os.environ.get("PRISM_API_KEY"))


# ── Git context — captured once at import time ────────────────────────────────

def _capture_git_context() -> dict:
    branch = (
        os.environ.get("GITHUB_REF_NAME")
        or os.environ.get("GIT_BRANCH")
        or os.environ.get("BRANCH_NAME")
    )
    commit = (
        os.environ.get("GITHUB_SHA", "")[:7]
        or os.environ.get("GIT_COMMIT", "")[:7]
    )
    if not branch:
        try:
            branch = subprocess.check_output(
                ["git", "rev-parse", "--abbrev-ref", "HEAD"],
                stderr=subprocess.DEVNULL, timeout=1,
            ).decode().strip()
        except Exception:
            branch = ""
    if not commit:
        try:
            commit = subprocess.check_output(
                ["git", "rev-parse", "--short", "HEAD"],
                stderr=subprocess.DEVNULL, timeout=1,
            ).decode().strip()
        except Exception:
            commit = ""
    return {
        "git_branch": "" if branch == "HEAD" else (branch or ""),
        "git_commit": commit or "",
        "app_name":   os.environ.get("PRISM_APP_NAME", ""),
    }


_GIT_CTX: dict = _capture_git_context() if _ACTIVE else {}


# ── Bypass reporting — fire-and-forget HTTP POST ──────────────────────────────

def _report_bypass(module_name: str) -> None:
    """POST a bypass event to /api/enforce/status. Never raises."""
    key = os.environ.get("PRISM_API_KEY")
    if not key or _MODE == "transparent":
        return

    app_url = os.environ.get("PRISM_APP_URL", "https://useprism.dev").rstrip("/")
    payload = json.dumps({
        "raw_module":  module_name,
        "environment": os.environ.get("PRISM_ENVIRONMENT", os.environ.get("APP_ENV", "production")),
        "git_branch":  _GIT_CTX.get("git_branch", ""),
        "git_commit":  _GIT_CTX.get("git_commit", ""),
        "app_name":    _GIT_CTX.get("app_name", ""),
    }).encode()

    def _fire() -> None:
        try:
            req = urllib.request.Request(
                f"{app_url}/api/enforce/status",
                data=payload,
                headers={
                    "Content-Type":  "application/json",
                    "Authorization": f"Bearer {key}",
                },
                method="POST",
            )
            urllib.request.urlopen(req, timeout=3)
        except Exception:
            pass  # observability must never break the caller

    threading.Thread(target=_fire, daemon=True).start()


class _PrismEnforceFinder(importlib.abc.MetaPathFinder):
    """Intercepts imports of raw AI provider SDKs."""

    def find_spec(
        self,
        fullname:    str,
        path:        Optional[Sequence[str]],
        target:      Optional[types.ModuleType] = None,
    ) -> Optional[importlib.machinery.ModuleSpec]:
        if not _ACTIVE or fullname not in _INTERCEPT:
            return None

        if _MODE == "strict":
            raise PrismEnforceError(fullname)

        if _MODE == "warn":
            branch_info = f" (branch: {_GIT_CTX['git_branch'] or 'unknown'})" if _GIT_CTX.get("git_branch") else ""
            warnings.warn(
                f'[prism-enforce] Raw import of "{fullname}" detected{branch_info}. '
                f"Import from prism directly to ensure cost tracking.",
                stacklevel=3,
            )
            _report_bypass(fullname)

        # Return a loader that substitutes the Prism class
        return importlib.machinery.ModuleSpec(
            name=fullname,
            loader=_PrismEnforceLoader(fullname),
        )


class _PrismEnforceLoader(importlib.abc.Loader):
    def __init__(self, module_name: str) -> None:
        self._module_name = module_name

    def create_module(self, spec: importlib.machinery.ModuleSpec) -> Optional[types.ModuleType]:
        return None  # use default semantics

    def exec_module(self, module: types.ModuleType) -> None:
        prism_module_path, prism_attr = _INTERCEPT.get(self._module_name, ("", ""))
        if not prism_module_path:
            return

        try:
            prism_mod = importlib.import_module(prism_module_path)
            prism_cls = getattr(prism_mod, prism_attr, None)
            if prism_cls is not None:
                # Expose the Prism class as the top-level name (e.g. openai.OpenAI)
                top_name = prism_attr.replace("Prism", "")  # "PrismAnthropic" → "Anthropic"
                setattr(module, prism_attr, prism_cls)
                setattr(module, top_name, prism_cls)
                # Also set as __class__ for isinstance checks
                module.__prism_wrapped__ = True  # type: ignore[attr-defined]
        except ImportError:
            # prism SDK not available — fail open (don't break the import)
            pass


if _ACTIVE:
    # Install finder at the front of meta_path so it takes priority
    _finder = _PrismEnforceFinder()
    if _finder not in sys.meta_path:
        sys.meta_path.insert(0, _finder)

    if _MODE != "transparent":
        import sys as _sys
        _sys.stderr.write(
            f"[prism-enforce] Active in {_MODE} mode — monitoring for raw provider SDK imports.\n"
        )
