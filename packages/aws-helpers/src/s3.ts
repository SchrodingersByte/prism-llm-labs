/**
 * S3 cost extractor.
 *
 * S3 bills per request. Per-call cost is tiny but adds up in agentic loops.
 * Prices (us-east-1, Standard storage):
 *   GET/HEAD/LIST : $0.0000004  per request
 *   PUT/COPY/POST : $0.000005   per request
 *
 * Usage:
 *   const res = await s3.getObject({ Bucket: "b", Key: "k" });
 *   ctx.reportActualCost(extractS3Cost(res, "get"));
 */

export type S3Operation = "get" | "put" | "list" | "delete";

const S3_PRICES: Record<S3Operation, number> = {
  get:    0.0000004,
  list:   0.0000004,
  delete: 0,          // DELETE is free
  put:    0.000005,
};

/**
 * Extract S3 request cost.
 * The response itself doesn't carry billing data — cost is deterministic from operation type.
 *
 * @param _response  - S3 response (unused; present for API consistency with other extractors)
 * @param operation  - The S3 operation performed
 */
export function extractS3Cost(
  _response:  unknown,
  operation:  S3Operation = "get",
): number {
  return S3_PRICES[operation] ?? 0;
}
