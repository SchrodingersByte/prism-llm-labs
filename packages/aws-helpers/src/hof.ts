/**
 * withPrismCost — Higher-order function that auto-detects the AWS service
 * from the response shape and calls ctx.reportActualCost() automatically.
 *
 * withPrismTags — Injects Prism cost-attribution tags (prism-session-id,
 * prism-project-id) into outgoing AWS resource calls so that AWS Cost Explorer
 * tag-based attribution can attribute costs back to specific sessions/projects.
 * Tagging is fire-and-forget — it never throws or delays the primary call.
 *
 * Usage:
 *   import { withPrismCost, withPrismTags } from "@prism-llm-labs/aws-helpers";
 *
 *   // Cost extraction only (existing pattern):
 *   await prismMcp.wrapToolCall("my_aws_tool", async (ctx) => {
 *     return withPrismCost(ctx, () =>
 *       lambdaClient.invoke({ FunctionName: "fn", Payload: input })
 *     );
 *   });
 *
 *   // Cost extraction + resource tagging (enables tag-based Cost Explorer attribution):
 *   await prismMcp.wrapToolCall("my_aws_tool", async (ctx) => {
 *     return withPrismTags(ctx, lambdaClient, "arn:aws:lambda:...:fn", () =>
 *       lambdaClient.invoke({ FunctionName: "fn", Payload: input })
 *     );
 *   });
 */

// Inline interface — avoids a build-time dependency on @prism-llm-labs/mcp-sdk
// Compatible with WrapContext from that package (duck-typed).
interface CostReporter {
  reportActualCost(usd: number): void;
}

interface TagContext {
  sessionId?:  string;
  projectId?:  string;
}

import { extractLambdaCost }   from "./lambda";
import { extractDynamoDBCost } from "./dynamodb";
import { extractS3Cost }       from "./s3";
import { extractBedrockCost }  from "./bedrock";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function detectAndExtractCost(response: any): number {
  if (!response) return 0;

  // Lambda: has $metadata.httpHeaders["x-amz-billed-duration"]
  const headers = response?.$metadata?.httpHeaders ?? {};
  if ("x-amz-billed-duration" in headers || "x-amz-billed-duration-ms" in headers) {
    return extractLambdaCost(response);
  }

  // DynamoDB: has ConsumedCapacity
  if ("ConsumedCapacity" in response) {
    return extractDynamoDBCost(response);
  }

  // Bedrock: has body (Uint8Array) + modelId in metadata
  if (response?.body instanceof Uint8Array || response?.modelId) {
    return extractBedrockCost(response);
  }

  // S3: request ID present but no other billing markers — charge GET rate
  if (response?.$metadata?.requestId && response?.Body) {
    return extractS3Cost(response, "get");
  }

  return 0;
}

/**
 * Build the Prism tag set to inject into AWS resources.
 * Always fire-and-forget — tagging must never block the primary call.
 */
function buildPrismTags(ctx: TagContext): Array<{ Key: string; Value: string }> {
  const tags: Array<{ Key: string; Value: string }> = [];
  const sessionId = ctx.sessionId ?? process.env["PRISM_SESSION_ID"];
  const projectId = ctx.projectId ?? process.env["PRISM_PROJECT"];
  if (sessionId) tags.push({ Key: "prism-session-id",  Value: sessionId });
  if (projectId) tags.push({ Key: "prism-project-id",  Value: projectId });
  return tags;
}

/**
 * Attempt to inject Prism attribution tags into an AWS resource.
 * Detects the resource type from the ARN prefix. Silently swallows all errors
 * so tagging failures never impact the primary tool call.
 *
 * @param client     - The AWS SDK client used for the primary call (must have .send())
 * @param resourceArn - ARN of the resource to tag
 * @param tags       - Prism attribution tags to inject
 */
async function injectResourceTags(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client:      any,
  resourceArn: string,
  tags:        Array<{ Key: string; Value: string }>,
): Promise<void> {
  if (!tags.length || !resourceArn) return;
  try {
    // Detect service from ARN: arn:aws:<service>:...
    const service = resourceArn.split(":")[2] ?? "";
    if (service === "lambda") {
      // Lambda: TagResource
      const { TagResourceCommand } = await import("@aws-sdk/client-lambda");
      const tagMap: Record<string, string> = {};
      tags.forEach(t => { tagMap[t.Key] = t.Value; });
      await client.send(new TagResourceCommand({ Resource: resourceArn, Tags: tagMap }));
    } else if (service === "dynamodb") {
      // DynamoDB: TagResource
      const { TagResourceCommand } = await import("@aws-sdk/client-dynamodb");
      await client.send(new TagResourceCommand({ ResourceArn: resourceArn, Tags: tags }));
    } else if (service === "s3") {
      // S3: PutBucketTagging (bucket level only — per-object tagging requires different call)
      const { PutBucketTaggingCommand } = await import("@aws-sdk/client-s3");
      await client.send(new PutBucketTaggingCommand({
        Bucket: resourceArn.split(":::")[1] ?? resourceArn,
        Tagging: { TagSet: tags },
      }));
    }
    // Other services: silently skip
  } catch { /* tagging is best-effort — never throw */ }
}

/**
 * Wrap an async AWS SDK call, auto-extract the cost, and report it to Prism.
 *
 * @param ctx   - WrapContext from PrismMCP.wrapToolCall()
 * @param fn    - An async function that makes the AWS SDK call and returns the response
 * @returns The original response, unmodified
 */
export async function withPrismCost<T>(
  ctx: CostReporter,
  fn:  () => Promise<T>,
): Promise<T> {
  const response = await fn();
  const cost = detectAndExtractCost(response);
  if (cost > 0) ctx.reportActualCost(cost);
  return response;
}

/**
 * Wrap an AWS SDK call with BOTH cost extraction AND resource tag injection.
 * Use this when you want tag-based AWS Cost Explorer attribution so costs
 * appear in Prism reconciliation linked to the specific session and project.
 *
 * Tagging is fire-and-forget (runs after the primary call, never throws).
 *
 * @param ctx         - WrapContext from PrismMCP.wrapToolCall() — used for cost reporting
 * @param client      - The AWS SDK client (e.g. LambdaClient, S3Client)
 * @param resourceArn - ARN of the resource to tag (e.g. Lambda function ARN)
 * @param fn          - The primary AWS SDK call
 * @param tagCtx      - Optional session/project IDs (falls back to env vars)
 */
export async function withPrismTags<T>(
  ctx:         CostReporter,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client:      any,
  resourceArn: string,
  fn:          () => Promise<T>,
  tagCtx:      TagContext = {},
): Promise<T> {
  const response = await fn();

  // Cost extraction (same as withPrismCost)
  const cost = detectAndExtractCost(response);
  if (cost > 0) ctx.reportActualCost(cost);

  // Tag injection — fire-and-forget
  const tags = buildPrismTags(tagCtx);
  void injectResourceTags(client, resourceArn, tags);

  return response;
}
