import json
from unittest.mock import MagicMock

import httpx
import pytest
import respx

import prism._config as _config
from prism._tracker import EventTracker

INGEST_URL = "https://ingest.test/api/ingest"


@pytest.fixture(autouse=True)
def patch_ingest_url(monkeypatch):
    monkeypatch.setattr(_config, "_ingest_url", INGEST_URL)


def _mock_response(model="gpt-4o", input_tokens=100, output_tokens=50, req_id="req-1"):
    r = MagicMock()
    r.usage.prompt_tokens = input_tokens
    r.usage.completion_tokens = output_tokens
    r.usage.prompt_tokens_details = None
    r.usage.completion_tokens_details = None  # prevent MagicMock from auto-generating non-serialisable attrs
    r.model = model
    r.id = req_id
    return r


@respx.mock
def test_capture_posts_to_ingest():
    route = respx.post(INGEST_URL).mock(
        return_value=httpx.Response(202, json={"imported_rows": 1})
    )
    tracker = EventTracker("prism_live_abcd_xyz123")
    tracker.capture(_mock_response(), 300, "my-project", "team-a", "production")

    assert route.called
    payload = json.loads(route.calls[0].request.content)
    event = payload["events"][0]
    assert event["model"] == "gpt-4o"
    assert event["input_tokens"] == 100
    assert event["output_tokens"] == 50
    assert event["latency_ms"] == 300
    assert event["environment"] == "production"
    assert event["project_id"] == "my-project"
    assert event["team_id"] == "team-a"


@respx.mock
def test_capture_never_raises_on_http_error():
    respx.post(INGEST_URL).mock(
        return_value=httpx.Response(500, text="server error")
    )
    tracker = EventTracker("prism_live_abcd_xyz123")
    # Must not raise
    tracker.capture(_mock_response(), 300, "proj", "team", "test")


@respx.mock
def test_capture_sets_cost_usd():
    route = respx.post(INGEST_URL).mock(
        return_value=httpx.Response(202, json={"imported_rows": 1})
    )
    tracker = EventTracker("prism_live_abcd_xyz123")
    tracker.capture(_mock_response(input_tokens=1_000_000, output_tokens=0), 0, "", "", "test")

    payload = json.loads(route.calls[0].request.content)
    event = payload["events"][0]
    assert event["cost_usd"] == pytest.approx(2.50, rel=1e-3)


@respx.mock
def test_org_extracted_from_key():
    route = respx.post(INGEST_URL).mock(
        return_value=httpx.Response(202, json={"imported_rows": 1})
    )
    tracker = EventTracker("prism_live_myorg_randomstuff")
    tracker.capture(_mock_response(), 0, "", "", "test")

    payload = json.loads(route.calls[0].request.content)
    event = payload["events"][0]
    assert event["org_id"] == "myorg"
