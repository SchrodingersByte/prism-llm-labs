"""End-user feedback helper tests (PRD-3): request shaping + error paths."""
import json

import httpx
import pytest
import respx

from prism.feedback import send_feedback

API_KEY = "prism_live_testorg_randomkey"
BASE_URL = "https://example.test"
ENDPOINT = f"{BASE_URL}/api/feedback"


@respx.mock
def test_send_feedback_posts_with_bearer_and_mapped_body():
    route = respx.post(ENDPOINT).mock(return_value=httpx.Response(201, json={"ok": True, "recorded": 1}))
    r = send_feedback(api_key=API_KEY, base_url=BASE_URL, value=1, trace_id="tr-1", feature_tag="support", comment="great")
    assert r == {"ok": True, "recorded": 1}

    req = route.calls[0].request
    assert req.headers["authorization"] == f"Bearer {API_KEY}"
    body = json.loads(req.content)
    assert body == {"value": 1, "trace_id": "tr-1", "feature_tag": "support", "comment": "great"}


def test_send_feedback_requires_api_key(monkeypatch):
    monkeypatch.delenv("PRISM_API_KEY", raising=False)
    with pytest.raises(ValueError, match="missing API key"):
        send_feedback(value=1)


@respx.mock
def test_send_feedback_raises_on_error_status():
    respx.post(ENDPOINT).mock(return_value=httpx.Response(401, json={"error": "Invalid or inactive API key"}))
    with pytest.raises(RuntimeError, match="Invalid or inactive API key"):
        send_feedback(api_key=API_KEY, base_url=BASE_URL, value=0)
