"""
Prism LLM observability SDK.

Drop-in replacements for LLM provider clients that add automatic
telemetry (tokens, cost, latency, git branch, developer attribution)
to every call without changing your application logic.

Quick start:
    # OpenAI
    from prism import OpenAI
    client = OpenAI(prism_key="prism_live_...")

    # Anthropic
    from prism import PrismAnthropic
    client = PrismAnthropic(prism_key="prism_live_...")

    # Google Gemini
    from prism import PrismGoogleAI
    client = PrismGoogleAI(prism_key="prism_live_...")

    # Gateway mode (any provider — routes via Prism proxy)
    from prism import OpenAI
    client = OpenAI(prism_key="prism_live_...", mode="gateway")
"""

from prism._client            import OpenAI
from prism._async_client      import AsyncOpenAI
from prism._config            import configure
from prism.middleware         import prism_feature, prism_tags, PrismMiddleware, get_current_feature
from prism.trace              import trace, get_current_trace, TraceContext
from prism.circuit_breaker    import PrismCircuitOpenError, is_circuit_open, record_provider_error, reset_breaker

# Canonical symmetric names — preferred going forward
PrismOpenAI      = OpenAI
PrismAsyncOpenAI = AsyncOpenAI

# Optional provider wrappers — installed via extras:
#   pip install prism-llm-labs[anthropic]   for PrismAnthropic
#   pip install prism-llm-labs[google]      for PrismGoogleAI
#   pip install prism-llm-labs[all]         for all providers
#
# Imported lazily so missing optional deps don't break the base install.
# They ARE accessible via `from prism import PrismAnthropic` at runtime.

def __getattr__(name: str):
    if name in ("PrismAnthropic",):
        try:
            from prism._anthropic_client import PrismAnthropic
            return PrismAnthropic
        except ImportError:
            raise ImportError(
                "PrismAnthropic requires the anthropic package. "
                "Install it with: pip install prism-llm-labs[anthropic]"
            ) from None

    if name in ("PrismGoogleAI", "PrismGoogleGenerativeAI"):
        try:
            from prism._google_client import PrismGoogleAI
            return PrismGoogleAI
        except ImportError:
            raise ImportError(
                "PrismGoogleAI requires google-generativeai. "
                "Install it with: pip install prism-llm-labs[google]"
            ) from None

    if name in ("MCPServer", "PrismMCP"):
        from prism._mcp_server import PrismMCP
        return PrismMCP

    if name == "PrismSession":
        from prism._mcp_server import PrismSession
        return PrismSession

    if name == "WrapContext":
        from prism._mcp_server import WrapContext
        return WrapContext

    if name == "PrismSessionBudgetExceededError":
        from prism._mcp_server import PrismSessionBudgetExceededError
        return PrismSessionBudgetExceededError

    if name == "PrismToolCallLimitError":
        from prism._mcp_server import PrismToolCallLimitError
        return PrismToolCallLimitError

    raise AttributeError(f"module 'prism' has no attribute {name!r}")


__all__ = [
    # Canonical symmetric names (preferred)
    "PrismOpenAI",
    "PrismAsyncOpenAI",
    "PrismAnthropic",                    # pip install prism-llm-labs[anthropic]
    "PrismGoogleAI",                     # pip install prism-llm-labs[google]
    "PrismGoogleGenerativeAI",           # alias for PrismGoogleAI
    # MCP — pip install prism-llm-labs[mcp]
    "PrismMCP",
    "PrismSession",
    "WrapContext",
    "PrismSessionBudgetExceededError",
    "PrismToolCallLimitError",
    "MCPServer",                         # backward-compat alias for PrismMCP
    # Backward-compat aliases (kept forever)
    "OpenAI",
    "AsyncOpenAI",
    "configure",
    # Middleware / auto-tagging
    "prism_feature",
    "prism_tags",
    "PrismMiddleware",
    "get_current_feature",
    # Application-layer tracing
    "trace",
    "get_current_trace",
    "TraceContext",
    # SDK-mode circuit breaker
    "PrismCircuitOpenError",
    "is_circuit_open",
    "record_provider_error",
    "reset_breaker",
]
