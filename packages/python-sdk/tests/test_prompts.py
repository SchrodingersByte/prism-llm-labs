"""Prompt registry fetch tests (PRD-4): mapping, {{variable}} compile, cache, errors."""
import httpx
import pytest
import respx

from prism.prompts import get_prompt, clear_prompt_cache

API_KEY = "prism_live_testorg_randomkey"
BASE_URL = "https://example.test"
ENDPOINT = f"{BASE_URL}/api/prompts/resolve"

RESOLVE_PAYLOAD = {
    "name": "support-reply",
    "version": 3,
    "content": [
        {"role": "system", "content": "You are a helpful agent."},
        {"role": "user", "content": "Hello {{customer}}"},
    ],
    "config": {"temperature": 0.2},
    "prompt_version": "support-reply@3",
}


@pytest.fixture(autouse=True)
def _clear_cache():
    clear_prompt_cache()
    yield
    clear_prompt_cache()


@respx.mock
def test_resolves_and_maps():
    route = respx.get(ENDPOINT).mock(return_value=httpx.Response(200, json=RESOLVE_PAYLOAD))
    p = get_prompt("support-reply", api_key=API_KEY, base_url=BASE_URL, label="production")

    assert p.version == 3
    assert p.prompt_version == "support-reply@3"
    assert len(p.messages) == 2
    assert p.config == {"temperature": 0.2}

    req = route.calls[0].request
    assert req.headers["authorization"] == f"Bearer {API_KEY}"
    assert req.url.params["name"] == "support-reply"
    assert req.url.params["label"] == "production"


@respx.mock
def test_compile_fills_variables_without_mutating():
    respx.get(ENDPOINT).mock(return_value=httpx.Response(200, json=RESOLVE_PAYLOAD))
    p = get_prompt("support-reply", api_key=API_KEY, base_url=BASE_URL)
    msgs = p.compile({"customer": "Dana"})
    assert msgs[1]["content"] == "Hello Dana"
    assert p.messages[1]["content"] == "Hello {{customer}}"  # original untouched


@respx.mock
def test_caches_within_ttl():
    route = respx.get(ENDPOINT).mock(return_value=httpx.Response(200, json=RESOLVE_PAYLOAD))
    get_prompt("support-reply", api_key=API_KEY, base_url=BASE_URL, label="production")
    get_prompt("support-reply", api_key=API_KEY, base_url=BASE_URL, label="production")
    assert route.call_count == 1


def test_requires_api_key(monkeypatch):
    monkeypatch.delenv("PRISM_API_KEY", raising=False)
    with pytest.raises(ValueError, match="missing API key"):
        get_prompt("x")


@respx.mock
def test_raises_on_error_status():
    respx.get(ENDPOINT).mock(return_value=httpx.Response(404, json={"error": "Prompt not found"}))
    with pytest.raises(RuntimeError, match="Prompt not found"):
        get_prompt("nope", api_key=API_KEY, base_url=BASE_URL)
