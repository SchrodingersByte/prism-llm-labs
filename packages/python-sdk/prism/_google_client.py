import os
import time
import threading
import uuid
import warnings
from typing import NamedTuple, Optional


class _ResponseStub(NamedTuple):
    model: str
    id: str

try:
    import google.generativeai as genai
    from google.generativeai import GenerativeModel as _BaseModel
except ImportError:
    raise ImportError(
        "google-generativeai package is required for PrismGoogleAI. "
        "Install it with: pip install prism-llm-labs[google]"
    )

from prism._budget import BudgetChecker
from prism._tracker import EventTracker
from prism._client import _detect_git_context
from prism._utils import spawn_capture


class _PrismGenerativeModel(_BaseModel):
    """Wraps GenerativeModel.generate_content() with budget + telemetry."""

    def __init__(self, *args, tracker: EventTracker, budget: BudgetChecker,
                 project: str, team: str, env: str, **kwargs) -> None:
        super().__init__(*args, **kwargs)
        self._prism_tracker = tracker
        self._prism_budget  = budget
        self._prism_project = project
        self._prism_team    = team
        self._prism_env     = env

    def generate_content(self, *args, tags: dict | None = None, **kwargs):
        if self._prism_budget:
            self._prism_budget.check_or_raise()

        t0 = time.monotonic()
        response = super().generate_content(*args, **kwargs)
        latency_ms = int((time.monotonic() - t0) * 1000)

        if self._prism_tracker:
            meta          = getattr(response, "usage_metadata", None)
            input_tokens  = getattr(meta, "prompt_token_count",      0) or 0
            output_tokens = getattr(meta, "candidates_token_count",  0) or 0
            model_name    = getattr(self, "model_name", "") or ""
            spawn_capture(
                self._prism_tracker.capture_raw,
                args=(
                    _ResponseStub(model=model_name, id=""),
                    latency_ms,
                    self._prism_project, self._prism_team, self._prism_env,
                    "google", input_tokens, output_tokens, 0,
                ),
                kwargs={"call_tags": tags},
            )

        return response


class PrismGoogleAI:
    """Wraps google.generativeai configuration + model creation with Prism observability.

    Usage:
        ai = PrismGoogleAI(google_api_key="AIza...", prism_key="prism_live_...")
        model = ai.GenerativeModel("gemini-1.5-pro")
        response = model.generate_content("Hello")
    """

    def __init__(
        self,
        google_api_key: str,
        prism_key: Optional[str] = None,
        project: Optional[str] = None,
        team: Optional[str] = None,
        environment: Optional[str] = None,
        session_id: Optional[str] = None,
        capture_payloads: str = "off",
        redact=None,
    ):
        genai.configure(api_key=google_api_key)
        key = prism_key or os.environ.get("PRISM_API_KEY")
        self._prism_project = project or os.environ.get("PRISM_PROJECT", "")
        self._prism_team    = team or os.environ.get("PRISM_TEAM", "")
        self._prism_env     = environment or os.environ.get("PRISM_ENVIRONMENT", "production")

        if key:
            git_ctx = _detect_git_context()
            sid = session_id or str(uuid.uuid4())
            default_tags = {**git_ctx, "session_id": sid}
            self._tracker: Optional[EventTracker] = EventTracker(key, default_tags=default_tags, capture_payloads=capture_payloads, redact=redact)
            self._budget:  Optional[BudgetChecker] = BudgetChecker(key)
        else:
            warnings.warn(
                "PRISM_API_KEY not set — observability disabled. "
                "Set the env var or pass prism_key= to enable.",
                stacklevel=2,
            )
            self._tracker = None
            self._budget  = None

    def GenerativeModel(self, model_name: str, **kwargs) -> _PrismGenerativeModel:
        return _PrismGenerativeModel(
            model_name,
            tracker=self._tracker,
            budget=self._budget,
            project=self._prism_project,
            team=self._prism_team,
            env=self._prism_env,
            **kwargs,
        )
