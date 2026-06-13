import { Ratelimit } from "@upstash/ratelimit";
import { redis } from "./redis";

// 500 events per minute per API key (sliding window)
export const ingestRatelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(500, "1 m"),
  prefix:  "rl:ingest",
});
