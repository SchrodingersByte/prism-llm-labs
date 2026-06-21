# @prism-llm-labs/aws-helpers

Real-time **AWS cost extractors** for use with [`@prism-llm-labs/mcp-sdk`](../mcp-sdk). They read
billing data that's **already present in AWS SDK responses** (consumed capacity, billed duration,
request metadata) and report it via `ctx.reportActualCost()` — so your MCP tool calls show
**actual** infra cost, not just catalog estimates, with **zero extra API calls**.

```bash
npm install @prism-llm-labs/aws-helpers
```

## Quick start — `withPrismCost`

Wrap an AWS call so cost is extracted and reported automatically:

```typescript
import { withPrismCost } from "@prism-llm-labs/aws-helpers";

await prismMcp.wrapToolCall("query_db", async (ctx) =>
  withPrismCost(ctx, () =>
    dynamo.getItem({ TableName: "items", Key: key, ReturnConsumedCapacity: "TOTAL" }),
  ),
);
```

> Tip: request the cost metadata AWS needs — e.g. `ReturnConsumedCapacity: "TOTAL"` for DynamoDB —
> so the extractor has real numbers to read.

## Individual extractors

For fine-grained control, compute the cost yourself and pass it to `ctx.reportActualCost()`:

```typescript
import {
  extractLambdaCost,
  extractDynamoDBCost, extractDynamoDBBatchCost,
  extractS3Cost,
  extractBedrockCost, BEDROCK_PRICING,
} from "@prism-llm-labs/aws-helpers";

await prismMcp.wrapToolCall("invoke_lambda", async (ctx) => {
  const res = await lambda.invoke({ FunctionName: "fn", Payload: payload });
  ctx.reportActualCost(extractLambdaCost(res, 256));   // 256 MB Lambda
  return res;
});
```

| Extractor | Reads cost from |
|---|---|
| `extractLambdaCost(res, memoryMb)` | Lambda billed duration × memory |
| `extractDynamoDBCost(res)` / `extractDynamoDBBatchCost(res)` | DynamoDB consumed capacity (RCUs/WCUs) |
| `extractS3Cost(res, operation)` | S3 request + transfer pricing |
| `extractBedrockCost(res)` | Bedrock model token usage (`BEDROCK_PRICING` table) |

All extractors are pure functions — no AWS API calls, no credentials needed beyond the response
you already have.

## Requirements

Node ≥ 18 · used alongside [`@prism-llm-labs/mcp-sdk`](../mcp-sdk).
