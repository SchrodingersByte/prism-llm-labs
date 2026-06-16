"""Offline-eval CI helper tests (PRD-2): request shaping, verdict mapping, gate."""
import httpx
import pytest
import respx

from prism.evals import run_eval, gate_eval, EvalGateError, EvalResult

API_KEY = "prism_live_testorg_randomkey"
BASE_URL = "https://example.test"
ENDPOINT = f"{BASE_URL}/api/evaluations/experiments"

PASS_PAYLOAD = {
    "run_id": "run-1", "overall_score": 0.91, "pass_rate": 0.95, "n_samples": 20,
    "edge_cases": 1, "cost_usd": 0.0123, "errors": 0, "threshold": 0.8,
    "meets_threshold": True, "baseline_run_id": None, "baseline_score": None,
    "score_delta": None, "regression": False, "passed": True,
}


@respx.mock
def test_run_eval_posts_with_bearer_and_mapped_body():
    route = respx.post(ENDPOINT).mock(return_value=httpx.Response(201, json=PASS_PAYLOAD))
    r = run_eval(
        api_key=API_KEY, base_url=BASE_URL, dataset="ds-1",
        subject={"model": "gpt-4o-mini", "system_prompt": "be terse"},
        scorers=["correctness"], threshold=0.8,
    )
    assert isinstance(r, EvalResult)
    assert r.run_id == "run-1" and r.overall_score == 0.91 and r.passed is True

    req = route.calls[0].request
    assert req.headers["authorization"] == f"Bearer {API_KEY}"
    import json
    body = json.loads(req.content)
    assert body["dataset_id"] == "ds-1"
    assert body["subject"]["model"] == "gpt-4o-mini"
    assert body["subject"]["system_prompt"] == "be terse"
    assert body["scorers"] == ["correctness"]
    assert body["threshold"] == 0.8


@respx.mock
def test_run_eval_raises_on_error_status():
    respx.post(ENDPOINT).mock(return_value=httpx.Response(400, json={"error": "No active provider key"}))
    with pytest.raises(RuntimeError, match="No active provider key"):
        run_eval(api_key=API_KEY, base_url=BASE_URL, dataset="ds-1", subject={"model": "x"})


def test_run_eval_requires_api_key(monkeypatch):
    monkeypatch.delenv("PRISM_API_KEY", raising=False)
    with pytest.raises(ValueError, match="missing API key"):
        run_eval(dataset="ds-1", subject={"model": "x"})


def test_run_eval_requires_dataset_or_items(monkeypatch):
    monkeypatch.setenv("PRISM_API_KEY", API_KEY)
    with pytest.raises(ValueError, match="dataset"):
        run_eval(subject={"model": "x"})


@respx.mock
def test_gate_eval_passes_through_on_success():
    respx.post(ENDPOINT).mock(return_value=httpx.Response(201, json=PASS_PAYLOAD))
    r = gate_eval(api_key=API_KEY, base_url=BASE_URL, dataset="ds-1", subject={"model": "x"})
    assert r.passed is True


@respx.mock
def test_gate_eval_raises_on_regression():
    payload = {**PASS_PAYLOAD, "overall_score": 0.7, "score_delta": -0.12, "regression": True, "passed": False}
    respx.post(ENDPOINT).mock(return_value=httpx.Response(201, json=payload))
    with pytest.raises(EvalGateError) as exc:
        gate_eval(api_key=API_KEY, base_url=BASE_URL, dataset="ds-1", subject={"model": "x"}, baseline_run_id="base-1")
    assert exc.value.result.regression is True
