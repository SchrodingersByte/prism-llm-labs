/**
 * Verify Slack request signatures.
 * https://api.slack.com/authentication/verifying-requests-from-slack
 */
import { createHmac, timingSafeEqual } from "crypto";

export function verifySlackSignature(
  signingSecret: string,
  timestamp:     string,
  body:          string,
  signature:     string,
): boolean {
  // Reject requests older than 5 minutes to prevent replay attacks
  const ts = parseInt(timestamp, 10);
  if (Math.abs(Date.now() / 1000 - ts) > 300) return false;

  const baseString = `v0:${timestamp}:${body}`;
  const expected   = "v0=" + createHmac("sha256", signingSecret)
    .update(baseString)
    .digest("hex");

  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}
