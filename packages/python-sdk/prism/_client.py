import os
import subprocess
import time
import threading
import uuid
import warnings
from typing import Optional

from openai import OpenAI as _BaseOpenAI
from openai.resources.chat.completions import Completions as _BaseCompletions

from prism._budget import BudgetChecker
from prism._tracker import EventTracker
from prism._utils import spawn_capture


def _run_git(*args: str) -> str:
    """Run a git command and return stdout, or '' on any error."""
    try:
        return subprocess.check_output(
            ["git", *args], stderr=subprocess.DEVNULL, timeout=1,
        ).decode().strip()
    except Exception:
        return ""


def _detect_git_context() -> dict:
    """Read git branch, commit, and author from env vars (CI) or subprocess (local dev)."""
    branch = (
        os.environ.get("GITHUB_REF_NAME")
        or os.environ.get("GIT_BRANCH")
        or os.environ.get("BRANCH_NAME")
        or _run_git("rev-parse", "--abbrev-ref", "HEAD")
    )
    commit = (
        (os.environ.get("GITHUB_SHA", "")[:7])
        or (os.environ.get("GIT_COMMIT", "")[:7])
        or _run_git("rev-parse", "--short", "HEAD")
    )

    # Developer identity — git config user.email / user.name
    # Also check CI env vars (GitHub Actions sets GITHUB_ACTOR)
    author_email = (
        os.environ.get("GIT_AUTHOR_EMAIL")
        or os.environ.get("PRISM_DEVELOPER_EMAIL")
        or _run_git("config", "user.email")
    )
    author_name = (
        os.environ.get("GIT_AUTHOR_NAME")
        or os.environ.get("PRISM_DEVELOPER_NAME")
        or _run_git("config", "user.name")
        # CI fallback: GitHub Actions exposes the actor username
        or os.environ.get("GITHUB_ACTOR")
    )

    ctx: dict = {}
    if branch and branch != "HEAD":
        ctx["git_branch"] = branch
    if commit:
        ctx["git_commit"] = commit
    if author_email:
        ctx["git_author_email"] = author_email
    if author_name:
        ctx["git_author_name"] = author_name
    return ctx


class _SyncStreamWrapper:
    """Wraps an OpenAI sync stream to fire telemetry when the final usage chunk arrives."""

    def __init__(self, stream, on_complete):
        self._stream = stream
        self._on_complete = on_complete

    def __iter__(self):
        last_usage = None
        last_model = None
        for chunk in self._stream:
            usage = getattr(chunk, "usage", None)
            if usage is not None:
                last_usage = usage
            model = getattr(chunk, "model", None)
            if model:
                last_model = model
            yield chunk
        self._on_complete(last_usage, last_model)

    def __enter__(self):
        self._stream.__enter__()
        return self

    def __exit__(self, *args):
        return self._stream.__exit__(*args)

    def __getattr__(self, name):
        return getattr(self._stream, name)


class _PrismCompletions(_BaseCompletions):
    """Subclass that overrides create() with budget + telemetry logic.

    Subclassing (rather than reassigning the attribute) survives OpenAI SDK
    version changes that alter the descriptor or make the attribute read-only.
    """

    def __init__(self, client: _BaseOpenAI, tracker: EventTracker, budget: BudgetChecker,
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

        if kwargs.get("stream"):
            so = kwargs.get("stream_options") or {}
            so["include_usage"] = True
            kwargs["stream_options"] = so

        t0 = time.monotonic()
        response = super().create(*args, **kwargs)
        latency_ms = int((time.monotonic() - t0) * 1000)

        if not self._prism_tracker:
            return response

        messages = kwargs.get("messages") or []

        if kwargs.get("stream"):
            # Wrap stream to capture usage from the final SSE chunk
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

            return _SyncStreamWrapper(response, _on_complete)

        spawn_capture(
            self._prism_tracker.capture,
            args=(response, latency_ms, self._prism_project, self._prism_team, self._prism_env, messages),
            kwargs={"call_tags": tags},
        )

        return response


class OpenAI(_BaseOpenAI):
    """Drop-in replacement for openai.OpenAI with Prism observability.

    Usage (SDK mode — monkey-patches the client):
        client = prism.OpenAI(prism_key="prism_live_...")

    Usage (gateway mode — routes all calls through the Prism proxy):
        client = prism.OpenAI(prism_key="prism_live_...", mode="gateway")
        # Equivalent to openai.OpenAI(base_url="https://useprism.dev/api/gateway/openai",
        #                              api_key="prism_live_...")
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
        **kwargs,
    ):
        key = prism_key or os.environ.get("PRISM_API_KEY")
        self._prism_project = project or os.environ.get("PRISM_PROJECT", "")
        self._prism_team    = team or os.environ.get("PRISM_TEAM", "")
        self._prism_env     = environment or os.environ.get("PRISM_ENVIRONMENT", "production")

        # Detect git context and session_id regardless of mode so gateway mode
        # can forward them as headers for server-side tag capture.
        git_ctx = _detect_git_context()
        sid     = session_id or str(uuid.uuid4())

        # PRISM_GATEWAY_URL auto-enables gateway mode.
        gateway_url   = os.environ.get("PRISM_GATEWAY_URL")
        effective_mode = "gateway" if gateway_url else mode

        if effective_mode == "gateway" and key:
            app_url = (
                gateway_url
                or os.environ.get("PRISM_APP_URL")
                or os.environ.get("NEXT_PUBLIC_APP_URL")
                or "https://useprism.dev"
            ).rstrip("/")
            # Include /v1 so the OpenAI SDK appends /chat/completions correctly:
            # base_url/v1 + /chat/completions → /api/gateway/openai/v1/chat/completions
            kwargs["base_url"] = kwargs.get("base_url") or f"{app_url}/api/gateway/openai/v1"
            kwargs["api_key"]  = key
            default_headers            = dict(kwargs.get("default_headers") or {})
            default_headers["x-prism-key"]     = key
            default_headers["x-prism-gateway"] = "true"  # signals gateway-required mode
            if git_ctx.get("git_branch"):
                default_headers["x-prism-branch"] = git_ctx["git_branch"]
            if git_ctx.get("git_commit"):
                default_headers["x-prism-commit"] = git_ctx["git_commit"]
            import json as _json
            extra_tags: dict = {"session_id": sid}
            if git_ctx.get("git_author_email"):
                extra_tags["git_author_email"] = git_ctx["git_author_email"]
            if git_ctx.get("git_author_name"):
                extra_tags["git_author_name"]  = git_ctx["git_author_name"]
            cost_center = os.environ.get("PRISM_COST_CENTER")
            if cost_center:
                extra_tags["cost_center"] = cost_center
            default_headers["x-prism-tags"] = _json.dumps(extra_tags)
            kwargs["default_headers"]  = default_headers

        super().__init__(*args, **kwargs)

        if key and effective_mode != "gateway":
            # Auto-generate session_id if not provided — groups all calls from this client
            # (git_ctx and sid already computed above)
            default_tags: dict = {**git_ctx, "session_id": sid}
            cost_center = os.environ.get("PRISM_COST_CENTER")
            if cost_center:
                default_tags["cost_center"] = cost_center
            tracker = EventTracker(key, default_tags=default_tags)
            budget  = BudgetChecker(key)
            # Replace the completions resource with our instrumented subclass
            self.chat.completions = _PrismCompletions(
                self, tracker, budget,
                self._prism_project, self._prism_team, self._prism_env,
            )
        elif not key:
            warnings.warn(
                "PRISM_API_KEY not set — observability disabled. "
                "Set the env var or pass prism_key= to enable.",
                stacklevel=2,
            )
