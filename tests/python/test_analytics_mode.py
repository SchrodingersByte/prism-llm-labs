"""
Python SDK — analytics mode E2E tests.

Usage (from project root):
  source .env.e2e
  cd tests/python && pytest test_analytics_mode.py -v
"""

import json
import os
import uuid
import requests
import pytest

from prism import OpenAI

# ── Fixtures ──────────────────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def seed():
    path = os.path.join(os.path.dirname(__file__), ".e2e-seed.json")
    if not os.path.exists(path):
        # Fallback: look in project root
        path = ".e2e-seed.json"
    if not os.path.exists(path):
        pytest.skip(".e2e-seed.json not found — run scripts/e2e/seed.ts first")
    with open(path) as f:
        return json.load(f)


@pytest.fixture(scope="module")
def openai_key():
    key = os.environ.get("OPENAI_API_KEY")
    if not key:
        pytest.skip("OPENAI_API_KEY not set")
    return key


@pytest.fixture(scope="module")
def app_url():
    return os.environ.get("NEXT_PUBLIC_APP_URL", "http://localhost:3000").rstrip("/")


@pytest.fixture(scope="module")
def client(seed, openai_key):
    """Analytics-mode Prism client."""
    # Ensure gateway mode is NOT active
    os.environ.pop("PRISM_GATEWAY_URL", None)
    return OpenAI(
        api_key=openai_key,
        prism_key=seed["analyticsRawKey"],
        project=seed["projectId"],
        environment="development",
    )


# ── Tests ─────────────────────────────────────────────────────────────────────

def test_basic_completion(client):
    """Basic LLM call — populates Overview KPIs and Models breakdown."""
    resp = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{"role": "user", "content": "Say: python-analytics-ok"}],
    )
    assert resp.choices[0].message.content
    print(f"\n  response: {resp.choices[0].message.content}")


def test_feature_tag(client):
    """Call with x-prism-feature header — populates Unit Economics features."""
    resp = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{"role": "user", "content": "Classify: happy message"}],
        extra_headers={"x-prism-feature": "sentiment-analysis"},
    )
    assert resp.choices[0].message.content


def test_session_calls(client, seed):
    """Multiple calls with same session_id — populates Sessions dashboard."""
    session_id = str(uuid.uuid4())
    session_client = OpenAI(
        api_key=os.environ["OPENAI_API_KEY"],
        prism_key=seed["analyticsRawKey"],
        project=seed["projectId"],
        environment="development",
        session_id=session_id,
    )
    for i in range(3):
        resp = session_client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": f"Python session call {i + 1}"}],
        )
        assert resp.choices[0].message.content


def test_cost_center_tag(client):
    """x-prism-cost-center header — populates FinOps Cost Centers tab."""
    resp = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{"role": "user", "content": "Cost allocation test"}],
        extra_headers={"x-prism-cost-center": "GL-E2E"},
    )
    assert resp.choices[0].message.content


def test_record_outcome(seed, app_url):
    """POST /api/outcomes — populates Unit Economics outcomes."""
    resp = requests.post(
        f"{app_url}/api/outcomes",
        headers={
            "Authorization": f"Bearer {seed['analyticsRawKey']}",
            "Content-Type":  "application/json",
        },
        json={
            "feature_tag": "sentiment-analysis",
            "success":     True,
            "value_usd":   1.00,
        },
        timeout=10,
    )
    assert resp.status_code in (200, 201, 204), f"outcomes POST failed: {resp.status_code} {resp.text}"
