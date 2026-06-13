/**
 * Lambda cost extractor.
 *
 * AWS Lambda bills in 1ms increments at $0.0000166667 per GB-second.
 * The billed duration and memory are in the HTTP response headers.
 *
 * Usage:
 *   const res = await lambdaClient.invoke({ FunctionName: "fn", Payload: payload });
 *   ctx.reportActualCost(extractLambdaCost(res, 128));   // 128 MB default
 */

const PRICE_PER_GB_SECOND = 0.0000166667;   // $0.0000166667/GB-s (us-east-1 arm64 / x86)
const INVOCATION_PRICE    = 0.0000002;       // $0.20 per million requests

/**
 * Extract the real billed cost from a Lambda invoke response.
 *
 * @param response    - Raw Lambda InvokeResponse (or any object with $metadata.httpHeaders)
 * @param memoryMb    - Function memory in MB. Defaults to 128 if not provided.
 *                      Pass the actual configured value for accuracy.
 */
export function extractLambdaCost(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  response:  any,
  memoryMb?: number,
): number {
  try {
    const headers: Record<string, string> =
      response?.$metadata?.httpHeaders ?? response?.ResponseMetadata?.HTTPHeaders ?? {};

    // x-amz-billed-duration — always present on Lambda invoke
    const billedMs   = parseInt(headers["x-amz-billed-duration"] ?? headers["x-amz-billed-duration-ms"] ?? "0", 10);
    // x-amz-executed-version carries the memory if included (Lambda@Edge)
    // Otherwise fall back to the caller-provided memoryMb
    const memMb      = memoryMb ?? 128;

    if (!billedMs) return INVOCATION_PRICE; // unknown duration → charge invocation only

    const gbSeconds  = (billedMs / 1000) * (memMb / 1024);
    return gbSeconds * PRICE_PER_GB_SECOND + INVOCATION_PRICE;
  } catch {
    return 0;
  }
}
