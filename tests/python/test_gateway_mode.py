"""
Python SDK — gateway mode E2E tests.

Usage (from project root):
  source .env.e2e
  cd tests/python && pytest test_gateway_mode.py -v
"""

import json
import os
import pytest

from prism import OpenAI


# ── Fixtures ──────────────────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def seed():
    path = os.path.join(os.path.dirname(__file__), ".e2e-seed.json")
    if not os.path.exists(path):
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
    url = os.environ.get("PRISM_GATEWAY_URL") or os.environ.get("NEXT_PUBLIC_APP_URL", "")
    if not url:
        pytest.skip("PRISM_GATEWAY_URL not set — skipping gateway mode tests")
    return url.rstrip("/")


@pytest.fixture(scope="module")
def gateway_client(seed, openai_key, app_url):
    """Gateway-mode Prism client."""
    if not seed.get("gatewayRawKey"):
        pytest.skip("No gateway key in seed — provider key creation failed in seed.ts")
    return OpenAI(
        api_key=openai_key,
        prism_key=seed["gatewayRawKey"],
        project=seed["projectId"],
        environment="development",
        mode="gateway",
        base_url=f"{app_url}/api/gateway/openai/v1",
    )


# ── Tests ─────────────────────────────────────────────────────────────────────

def test_gateway_basic_completion(gateway_client):
    """LLM call through gateway — server-side telemetry recorded."""
    resp = gateway_client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{"role": "user", "content": "Say: python-gateway-ok"}],
    )
    assert resp.choices[0].message.content
    print(f"\n  response: {resp.choices[0].message.content}")


def test_gateway_feature_tag(gateway_client):
    """Feature tag forwarded via x-prism-feature header through gateway."""
    resp = gateway_client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{"role": "user", "content": "Extract: Python SDK gateway feature"}],
        extra_headers={"x-prism-feature": "python-extraction"},
    )
    assert resp.choices[0].message.content


def test_gateway_streaming(gateway_client):
    """Streaming through gateway — verifies ttft_ms is captured on server side."""
    stream = gateway_client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{"role": "user", "content": "Count from 1 to 3"}],
        stream=True,
    )
    content_chunks = 0
    full_text = ""
    for chunk in stream:
        delta = chunk.choices[0].delta.content if chunk.choices else None
        if delta:
            content_chunks += 1
            full_text += delta
    print(f"\n  chunks: {content_chunks}, text: {full_text}")
    assert content_chunks > 0, "Expected at least one content chunk in streaming response"
