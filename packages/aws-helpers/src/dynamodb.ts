/**
 * DynamoDB cost extractor.
 *
 * DynamoDB charges per Request Unit (RCU/WCU) when you use on-demand capacity.
 * Pass ReturnConsumedCapacity: "TOTAL" to the SDK call to get the unit count.
 *
 * Prices (on-demand, us-east-1):
 *   Read  : $0.25  per million RCU  = $0.00000025 per RCU
 *   Write : $1.25  per million WCU  = $0.00000125 per WCU
 *
 * Usage:
 *   const res = await dynamo.getItem({ ..., ReturnConsumedCapacity: "TOTAL" });
 *   ctx.reportActualCost(extractDynamoDBCost(res, "read"));
 */

const RCU_PRICE = 0.00000025;   // per read capacity unit
const WCU_PRICE = 0.00000125;   // per write capacity unit

export type DynamoDBOperation = "read" | "write";

/**
 * Extract cost from a DynamoDB response.
 *
 * @param response    - Raw DynamoDB response with ConsumedCapacity field
 * @param operation   - "read" (GetItem, Query, Scan) or "write" (PutItem, UpdateItem, DeleteItem)
 */
export function extractDynamoDBCost(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  response:  any,
  operation: DynamoDBOperation = "read",
): number {
  try {
    // SDK v3 shape: response.ConsumedCapacity.CapacityUnits
    const units =
      response?.ConsumedCapacity?.CapacityUnits ??
      response?.consumed_capacity?.capacity_units ??
      0;

    const price = operation === "write" ? WCU_PRICE : RCU_PRICE;
    return Number(units) * price;
  } catch {
    return 0;
  }
}

/**
 * Extract cost from a DynamoDB BatchWrite/TransactWrite response.
 * Sums all ConsumedCapacity entries.
 */
export function extractDynamoDBBatchCost(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  response:  any,
  operation: DynamoDBOperation = "write",
): number {
  try {
    const entries: unknown[] = response?.ConsumedCapacity ?? [];
    const total = (entries as Record<string, unknown>[]).reduce((sum, entry) => {
      return sum + (Number(entry?.["CapacityUnits"]) || 0);
    }, 0);
    const price = operation === "write" ? WCU_PRICE : RCU_PRICE;
    return total * price;
  } catch {
    return 0;
  }
}
