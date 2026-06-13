from pydantic import BaseModel


class LLMEvent(BaseModel):
    event_id: str
    timestamp: str
    org_id: str
    project_id: str
    project_name: str
    team_id: str
    user_id: str
    environment: str
    provider: str
    model: str
    input_tokens: int
    output_tokens: int
    cached_tokens: int
    cost_usd: float
    latency_ms: int
    status_code: int
    request_id: str
    tags: str
