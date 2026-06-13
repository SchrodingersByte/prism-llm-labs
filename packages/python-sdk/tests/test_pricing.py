from prism._pricing import calculate_cost, MODEL_PRICING


def test_gpt4o_basic_cost():
    cost = calculate_cost("gpt-4o", 1_000_000, 1_000_000)
    assert abs(cost - (2.50 + 10.00)) < 0.0001


def test_gpt4o_cached_input():
    cost = calculate_cost("gpt-4o", 1_000_000, 0, cached_tokens=1_000_000)
    assert abs(cost - 1.25) < 0.0001


def test_unknown_model_returns_zero():
    assert calculate_cost("gpt-99-ultra", 1000, 500) == 0.0


def test_zero_tokens():
    assert calculate_cost("gpt-4o", 0, 0) == 0.0


def test_all_models_have_non_negative_prices():
    for model, p in MODEL_PRICING.items():
        assert p["input"] >= 0, f"{model} has negative input price"
        assert p["output"] >= 0, f"{model} has negative output price"


def test_anthropic_model_cost():
    cost = calculate_cost("claude-3-5-sonnet-20241022", 1_000_000, 1_000_000)
    assert abs(cost - (3.00 + 15.00)) < 0.0001


def test_cached_tokens_use_cached_price():
    # gpt-4o: input=$2.50, cached_input=$1.25 per 1M
    full_cost    = calculate_cost("gpt-4o", 1_000_000, 0, cached_tokens=0)
    cached_cost  = calculate_cost("gpt-4o", 1_000_000, 0, cached_tokens=1_000_000)
    assert cached_cost < full_cost
