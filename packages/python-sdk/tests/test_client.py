import os
import pytest
from unittest.mock import patch

from prism._client import OpenAI, _PrismCompletions


def test_client_warns_without_api_key():
    with patch.dict(os.environ, {k: "" for k in ["PRISM_API_KEY", "PRISM_PROJECT", "PRISM_TEAM"]}, clear=False):
        os.environ.pop("PRISM_API_KEY", None)
        with pytest.warns(UserWarning, match="PRISM_API_KEY not set"):
            client = OpenAI(api_key="sk-fake-key-for-testing")
    # When no key is set, completions remains the base class (not instrumented)
    assert not isinstance(client.chat.completions, _PrismCompletions)


def test_client_initialises_tracker_with_key():
    # Patch at the source module so reload isn't needed
    with (
        patch("prism._tracker.EventTracker") as MockTracker,
        patch("prism._budget.BudgetChecker") as MockBudget,
    ):
        client = OpenAI(api_key="sk-fake", prism_key="prism_live_test_abcd1234")
        # Tracker and budget are stored inside _PrismCompletions
        assert isinstance(client.chat.completions, _PrismCompletions)
        assert client.chat.completions._prism_tracker is not None
        assert client.chat.completions._prism_budget is not None


def test_client_reads_key_from_env():
    with patch.dict(os.environ, {"PRISM_API_KEY": "prism_live_env_key123456"}):
        with (
            patch("prism._tracker.EventTracker"),
            patch("prism._budget.BudgetChecker"),
        ):
            client = OpenAI(api_key="sk-fake")
            assert isinstance(client.chat.completions, _PrismCompletions)


def test_client_project_from_env():
    with patch.dict(os.environ, {
        "PRISM_API_KEY": "prism_live_test_xyz",
        "PRISM_PROJECT": "my-project",
        "PRISM_TEAM": "team-a",
    }):
        with (
            patch("prism._tracker.EventTracker"),
            patch("prism._budget.BudgetChecker"),
        ):
            client = OpenAI(api_key="sk-fake")
            assert client._prism_project == "my-project"
            assert client._prism_team == "team-a"
