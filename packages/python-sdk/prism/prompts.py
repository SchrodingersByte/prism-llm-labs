"""
Prompt registry fetch helper (PRD-4).

Resolve a managed prompt by name + label (Langfuse-style) at runtime — ship
prompt changes by promoting a label, no code redeploy. Results are cached
in-memory by name+label with a short TTL.

    from prism.prompts import get_prompt
    p = get_prompt("support-reply", label="production")
    messages = p.compile({"customer": "Dana"})   # fills {{customer}}
    # pass p.prompt_version as tags['prompt_version'] so attribution flows

Server: GET /api/prompts/resolve (authenticated by PRISM_API_KEY).
"""
from __future__ import annotations

import os
import re
import time
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple

import httpx

_DEFAULT_APP_URL = "https://prism-dip-dey-s-projects.vercel.app"
_VAR_RE = re.compile(r"\{\{\s*(\w+)\s*\}\}")

# key -> (value, expires_at_epoch_seconds)
_cache: Dict[str, Tuple["ResolvedPrompt", float]] = {}


@dataclass
class ResolvedPrompt:
    name: str
    version: int
    messages: List[Dict[str, str]]
    config: Dict[str, Any]
    prompt_version: str  # "name@version" → stamp as tags['prompt_version']

    def compile(self, variables: Optional[Dict[str, Any]] = None) -> List[Dict[str, str]]:
        """Fill {{variable}} placeholders; returns a new messages list."""
        if not variables:
            return [dict(m) for m in self.messages]

        def repl(match: "re.Match[str]") -> str:
            key = match.group(1)
            return str(variables[key]) if key in variables else match.group(0)

        return [{"role": m["role"], "content": _VAR_RE.sub(repl, m["content"])} for m in self.messages]


def clear_prompt_cache() -> None:
    _cache.clear()


def _base_url(explicit: Optional[str]) -> str:
    url = explicit or os.environ.get("PRISM_GATEWAY_URL") or os.environ.get("PRISM_APP_URL") or _DEFAULT_APP_URL
    return url.rstrip("/")


def get_prompt(
    name: str,
    *,
    label: Optional[str] = None,
    version: Optional[int] = None,
    project_id: Optional[str] = None,
    api_key: Optional[str] = None,
    base_url: Optional[str] = None,
    ttl_ms: int = 60_000,
    timeout: float = 10.0,
) -> ResolvedPrompt:
    key = api_key or os.environ.get("PRISM_API_KEY")
    if not key:
        raise ValueError("Prism get_prompt: missing API key (set PRISM_API_KEY or pass api_key).")

    label_used = label or "production"
    cache_key = f"{name}:{'v' + str(version) if version is not None else label_used}:{project_id or ''}"
    if ttl_ms > 0:
        hit = _cache.get(cache_key)
        if hit and hit[1] > time.time():
            return hit[0]

    params: Dict[str, str] = {"name": name}
    if version is not None:
        params["version"] = str(version)
    else:
        params["label"] = label_used
    if project_id:
        params["project_id"] = project_id

    resp = httpx.get(
        f"{_base_url(base_url)}/api/prompts/resolve",
        params=params,
        headers={"Authorization": f"Bearer {key}"},
        timeout=timeout,
    )
    try:
        data = resp.json()
    except Exception:
        data = {}
    if resp.status_code >= 300:
        raise RuntimeError(f"Prism get_prompt failed ({resp.status_code}): {data.get('error', resp.text)}")

    content = data.get("content") or []
    value = ResolvedPrompt(
        name=str(data.get("name", name)),
        version=int(data.get("version", 0)),
        messages=[{"role": m.get("role", ""), "content": m.get("content", "")} for m in content],
        config=data.get("config") or {},
        prompt_version=str(data.get("prompt_version", f"{name}@{data.get('version', 0)}")),
    )
    if ttl_ms > 0:
        _cache[cache_key] = (value, time.time() + ttl_ms / 1000.0)
    return value
