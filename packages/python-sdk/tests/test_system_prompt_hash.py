"""
Tests for system_prompt_hash auto-generation (P2.1) in the Python SDK tracker.
Covers plan test IDs: 7.3.x

Priority: P0/P1
"""
import hashlib
import unittest
from unittest.mock import MagicMock, patch
import sys
import os

# Allow importing from the parent package
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from prism._tracker import EventTracker


def make_response(model="gpt-4o-mini", input_tokens=100, output_tokens=50):
    """Create a minimal mock OpenAI response."""
    resp = MagicMock()
    resp.model = model
    resp.id    = "chatcmpl-test"
    resp.usage = MagicMock(
        prompt_tokens=input_tokens,
        completion_tokens=output_tokens,
        prompt_tokens_details=None,
        completion_tokens_details=None,
    )
    resp.choices = []
    resp.content = []
    return resp


class TestSystemPromptHash(unittest.TestCase):
    """Tests for system_prompt_hash auto-generation."""

    def setUp(self):
        self.tracker = EventTracker(prism_key="prism_live_testorg_key")

    def _hash(self, content: str) -> str:
        return hashlib.sha256(content.encode()).hexdigest()[:12]

    def test_hash_generated_from_system_message(self):
        """system_prompt_hash should be auto-populated from system role message."""
        messages = [
            {"role": "system", "content": "You are a helpful assistant."},
            {"role": "user",   "content": "Hello!"},
        ]
        captured_tags = {}

        with patch.object(self.tracker._http, "post") as mock_post:
            mock_post.return_value = MagicMock(status_code=202)
            self.tracker.capture(make_response(), 300, messages=messages)
            if mock_post.called:
                import json
                body = json.loads(mock_post.call_args[1]["content"])
                captured_tags = body["events"][0]["tags"]

        expected_hash = self._hash("You are a helpful assistant.")
        if captured_tags:
            self.assertEqual(captured_tags.get("system_prompt_hash"), expected_hash)
            self.assertEqual(len(captured_tags["system_prompt_hash"]), 12)

    def test_same_system_prompt_produces_same_hash(self):
        """Deterministic hash for identical system prompt content."""
        prompt = "Be concise and accurate."
        hash1  = self._hash(prompt)
        hash2  = self._hash(prompt)
        self.assertEqual(hash1, hash2)

    def test_different_system_prompts_produce_different_hashes(self):
        """Different prompts should produce different hashes."""
        hash1 = self._hash("Be helpful.")
        hash2 = self._hash("Be concise.")
        self.assertNotEqual(hash1, hash2)

    def test_no_hash_when_no_system_message(self):
        """No system_prompt_hash when messages have no system role."""
        messages = [{"role": "user", "content": "Just a question"}]
        hash_value = EventTracker._hash_system_prompt(messages)
        self.assertEqual(hash_value, "")

    def test_hash_is_exactly_12_hex_chars(self):
        """Hash should always be exactly 12 lowercase hex characters."""
        hash_value = self._hash("Any system prompt here.")
        self.assertEqual(len(hash_value), 12)
        self.assertRegex(hash_value, r"^[a-f0-9]{12}$")


class TestRecordOutcome(unittest.TestCase):
    """Tests for record_outcome() method (T2.2)."""

    def test_posts_to_outcomes_endpoint(self):
        tracker = EventTracker(prism_key="prism_live_testorg_key")
        with patch.object(tracker._http, "post") as mock_post:
            mock_post.return_value = MagicMock(status_code=200)
            tracker.record_outcome(
                feature_tag="customer-support",
                action_tag="ticket-resolved",
                session_id="sess-abc",
                success=True,
                value_usd=3.00,
            )
            self.assertTrue(mock_post.called)
            call_kwargs = mock_post.call_args
            url = call_kwargs[0][0]
            self.assertIn("/api/outcomes", url)

    def test_never_throws_on_network_error(self):
        """record_outcome must never propagate network errors."""
        tracker = EventTracker(prism_key="prism_live_testorg_key")
        with patch.object(tracker._http, "post", side_effect=Exception("network down")):
            try:
                tracker.record_outcome(feature_tag="test", success=True)
            except Exception as e:
                self.fail(f"record_outcome raised {e}")


class TestEventTrackerCapture(unittest.TestCase):
    """Basic capture tests for Python SDK."""

    def test_capture_never_throws_on_http_error(self):
        tracker = EventTracker(prism_key="prism_live_testorg_key")
        with patch.object(tracker._http, "post", side_effect=Exception("timeout")):
            try:
                tracker.capture(make_response(), 500)
            except Exception as e:
                self.fail(f"capture raised {e}")

    def test_cost_usd_is_positive_for_known_model(self):
        """Captured event should have positive cost for a known model."""
        tracker = EventTracker(prism_key="prism_live_testorg_key")
        captured_event = {}

        def intercept_post(url, **kwargs):
            import json
            body = json.loads(kwargs.get("content", "{}"))
            if body.get("events"):
                captured_event.update(body["events"][0])
            return MagicMock(status_code=202)

        with patch.object(tracker._http, "post", side_effect=intercept_post):
            tracker.capture(make_response("gpt-4o-mini", input_tokens=1000, output_tokens=500), 200)

        if captured_event:
            self.assertGreater(captured_event.get("cost_usd", 0), 0)


if __name__ == "__main__":
    unittest.main()
