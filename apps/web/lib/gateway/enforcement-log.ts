import { ingestToTinybird } from "@/lib/tinybird/client";
import { redis } from "@/lib/upstash/redis";
import { v4 as uuidv4 } from "uuid";

export type EnforcementLayer =
  | "auth"
  | "rate_limit"
  | "circuit_breaker"
  | "spend_cap"
  | "gateway_mode"
  | "data_residency"
  | "model_governance"
  | "pii_guard"
  | "customer_quota"
  | "guardrail";

export interface GatewayRejectionContext {
  orgId:         string;
  apiKeyId:      string;
  provider:      string;
  model:         string;
  environment:   string;
  layer:         EnforcementLayer;
  rejectionCode: string;
  httpStatus:    number;
  reason:        string;
  traceId:       string;
}

export function logGatewayRejection(ctx: GatewayRejectionContext): void {
  const today    = new Date().toISOString().slice(0, 10);
  const redisKey = `rejection:counts:${ctx.orgId}:${today}`;
  const field    = `${ctx.layer}:${ctx.rejectionCode}`;

  void redis.hincrby(redisKey, field, 1)
    .then(() => redis.expire(redisKey, 32 * 86_400))
    .catch(() => {});

  void ingestToTinybird([{
    event_id:       uuidv4(),
    timestamp:      new Date().toISOString().replace("T", " ").slice(0, 23),
    org_id:         ctx.orgId,
    api_key_id:     ctx.apiKeyId,
    provider:       ctx.provider,
    model:          ctx.model,
    environment:    ctx.environment,
    layer:          ctx.layer,
    rejection_code: ctx.rejectionCode,
    http_status:    ctx.httpStatus,
    reason:         ctx.reason,
    trace_id:       ctx.traceId,
    ttl_days:       90,
  }], "gateway_enforcement_logs").catch(() => {});
}
