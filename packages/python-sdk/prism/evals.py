"""
Offline-eval CI helper (PRD-2).

Run a dataset through a subject config (model + prompt + params) from CI, score
it server-side with Prism's scorer library, and gate the build on a quality
threshold and/or a regression vs a baseline run. ``gate_eval`` raises
``EvalGateError`` when the run does not pass — wire it into a CI step so a
regression fails the pipeline (the ``prism-evals`` console script exits non-zero).

    from prism.evals import gate_eval
    gate_eval(
        dataset="DATASET_UUID",
        subject={"model": "gpt-4o-mini"},
        scorers=["correctness"],
        threshold=0.8,
        baseline_run_id=os.environ.get("PRISM_BASELINE_RUN_ID"),
    )

Server: POST /api/evaluations/experiments (authenticated by PRISM_API_KEY).
"""
from __future__ import annotations

import json
import os
import sys
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Sequence

import httpx

_DEFAULT_APP_URL = "https://prism-dip-dey-s-projects.vercel.app"


@dataclass
class EvalResult:
    run_id: str
    overall_score: float
    pass_rate: float
    n_samples: int
    edge_cases: int
    cost_usd: float
    errors: int
    threshold: Optional[float]
    meets_threshold: bool
    baseline_run_id: Optional[str]
    baseline_score: Optional[float]
    score_delta: Optional[float]
    regression: bool
    passed: bool


class EvalGateError(Exception):
    """Raised by ``gate_eval`` when an experiment does not pass its gate."""

    def __init__(self, result: EvalResult) -> None:
        msg = f"Prism eval gate failed: score {result.overall_score}"
        if result.threshold is not None:
            msg += f" (threshold {result.threshold})"
        if result.regression:
            msg += f", REGRESSION vs baseline (delta {result.score_delta})"
        super().__init__(msg)
        self.result = result


def _base_url(explicit: Optional[str]) -> str:
    url = (
        explicit
        or os.environ.get("PRISM_GATEWAY_URL")
        or os.environ.get("PRISM_APP_URL")
        or _DEFAULT_APP_URL
    )
    return url.rstrip("/")


def _git_sha(explicit: Optional[str]) -> Optional[str]:
    return (
        explicit
        or os.environ.get("GITHUB_SHA")
        or os.environ.get("GIT_COMMIT")
        or os.environ.get("PRISM_GIT_SHA")
    )


def run_eval(
    *,
    subject: Dict[str, Any],
    dataset: Optional[str] = None,
    items: Optional[Sequence[Dict[str, Any]]] = None,
    name: Optional[str] = None,
    scorers: Optional[List[str]] = None,
    judge_model: Optional[str] = None,
    rubric: Optional[str] = None,
    provider_key_id: Optional[str] = None,
    baseline_run_id: Optional[str] = None,
    git_sha: Optional[str] = None,
    max_samples: Optional[int] = None,
    threshold: Optional[float] = None,
    regression_threshold: Optional[float] = None,
    api_key: Optional[str] = None,
    base_url: Optional[str] = None,
    timeout: float = 300.0,
) -> EvalResult:
    """Run an experiment and return its verdict.

    Does NOT raise on a failing gate — inspect ``result.passed``. Raises on
    transport/auth/validation errors.
    """
    key = api_key or os.environ.get("PRISM_API_KEY")
    if not key:
        raise ValueError("Prism eval: missing API key (set PRISM_API_KEY or pass api_key).")
    if not dataset and not items:
        raise ValueError("Prism eval: provide `dataset` (id) or `items`.")

    body: Dict[str, Any] = {
        "dataset_id": dataset,
        "items": list(items) if items else None,
        "name": name,
        "subject": {
            "model": subject["model"],
            "system_prompt": subject.get("system_prompt"),
            "prompt_version": subject.get("prompt_version"),
            "params": subject.get("params"),
        },
        "scorers": scorers or ["correctness"],
        "judge_model": judge_model,
        "rubric": rubric,
        "provider_key_id": provider_key_id,
        "baseline_run_id": baseline_run_id,
        "git_sha": _git_sha(git_sha),
        "max_samples": max_samples,
        "threshold": threshold,
        "regression_threshold": regression_threshold,
    }
    body = {k: v for k, v in body.items() if v is not None}

    resp = httpx.post(
        f"{_base_url(base_url)}/api/evaluations/experiments",
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
        json=body,
        timeout=timeout,
    )
    try:
        data = resp.json()
    except Exception:
        data = {}
    if resp.status_code >= 300:
        raise RuntimeError(f"Prism eval failed ({resp.status_code}): {data.get('error', resp.text)}")

    return EvalResult(
        run_id=str(data.get("run_id", "")),
        overall_score=float(data.get("overall_score", 0)),
        pass_rate=float(data.get("pass_rate", 0)),
        n_samples=int(data.get("n_samples", 0)),
        edge_cases=int(data.get("edge_cases", 0)),
        cost_usd=float(data.get("cost_usd", 0)),
        errors=int(data.get("errors", 0)),
        threshold=None if data.get("threshold") is None else float(data["threshold"]),
        meets_threshold=bool(data.get("meets_threshold")),
        baseline_run_id=data.get("baseline_run_id"),
        baseline_score=None if data.get("baseline_score") is None else float(data["baseline_score"]),
        score_delta=None if data.get("score_delta") is None else float(data["score_delta"]),
        regression=bool(data.get("regression")),
        passed=bool(data.get("passed")),
    )


def gate_eval(**kwargs: Any) -> EvalResult:
    """Like :func:`run_eval`, but raises :class:`EvalGateError` when the gate fails."""
    result = run_eval(**kwargs)
    if not result.passed:
        raise EvalGateError(result)
    return result


def run_eval_cli(argv: Optional[Sequence[str]] = None) -> None:
    """CLI entry: read a JSON config, run the gate, print a summary, exit non-zero on failure.

    Wired as the ``prism-evals`` console script:  prism-evals ./prism.eval.json
    """
    args = list(argv if argv is not None else sys.argv[1:])
    config_path = args[0] if args else os.environ.get("PRISM_EVAL_CONFIG")
    if not config_path:
        print("Usage: prism-evals <config.json>  (or set PRISM_EVAL_CONFIG)", file=sys.stderr)
        sys.exit(2)

    try:
        with open(config_path, "r", encoding="utf-8") as fh:
            opts = json.load(fh)
    except Exception as e:  # noqa: BLE001
        print(f"prism-evals: could not read config {config_path}: {e}", file=sys.stderr)
        sys.exit(2)

    try:
        r = run_eval(**opts)
    except Exception as e:  # noqa: BLE001
        print(f"[prism-evals] error: {e}", file=sys.stderr)
        sys.exit(2)

    tag = "PASS" if r.passed else "FAIL"
    extra = ""
    if r.threshold is not None:
        extra += f" · threshold {r.threshold}"
    if r.score_delta is not None:
        extra += f" · delta vs baseline {r.score_delta}"
    if r.regression:
        extra += " · REGRESSION"
    print(
        f"[prism-evals] {tag} — score {r.overall_score} "
        f"(pass-rate {r.pass_rate}, {r.n_samples} samples, ${r.cost_usd}){extra}"
    )
    print(f"[prism-evals] run: {r.run_id}")
    sys.exit(0 if r.passed else 1)
