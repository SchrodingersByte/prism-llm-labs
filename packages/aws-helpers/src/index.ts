/**
 * @prism-llm-labs/aws-helpers
 *
 * Real-time AWS cost extractors for use with PrismMCP.wrapToolCall().
 * Reads billing data already present in AWS SDK responses — zero extra API calls.
 *
 * Quick start:
 *   import { withPrismCost } from "@prism-llm-labs/aws-helpers";
 *
 *   await prismMcp.wrapToolCall("query_db", async (ctx) => {
 *     return withPrismCost(ctx, () =>
 *       dynamo.getItem({ TableName: "t", Key: k, ReturnConsumedCapacity: "TOTAL" })
 *     );
 *   });
 *
 * Individual extractors (for fine-grained control):
 *   import { extractLambdaCost, extractDynamoDBCost } from "@prism-llm-labs/aws-helpers";
 *   ctx.reportActualCost(extractLambdaCost(res, 256));   // 256 MB Lambda
 */

export { extractLambdaCost }               from "./lambda";
export { extractDynamoDBCost, extractDynamoDBBatchCost, type DynamoDBOperation } from "./dynamodb";
export { extractS3Cost, type S3Operation } from "./s3";
export { extractBedrockCost, BEDROCK_PRICING } from "./bedrock";
export { withPrismCost }                   from "./hof";
