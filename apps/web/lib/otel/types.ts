/**
 * Minimal TypeScript types for the OTLP/JSON (protobuf-JSON encoding) format.
 *
 * Based on the OpenTelemetry GenAI semantic conventions:
 * https://opentelemetry.io/docs/specs/semconv/gen-ai/
 *
 * Only the fields we actually use are typed here; everything else is unknown.
 */

export interface AnyValue {
  stringValue?: string;
  boolValue?:   boolean;
  intValue?:    string | number;  // protobuf int64 comes as string
  doubleValue?: number;
  arrayValue?:  { values?: AnyValue[] };
  kvlistValue?: { values?: KeyValue[] };
}

export interface KeyValue {
  key:   string;
  value: AnyValue;
}

export interface OtlpSpan {
  traceId:             string;
  spanId:              string;
  parentSpanId?:       string;
  name:                string;
  kind?:               number;  // SpanKind enum
  startTimeUnixNano:   string;  // nanoseconds as string (int64)
  endTimeUnixNano:     string;
  attributes?:         KeyValue[];
  status?: {
    code?:    number;  // 0=unset, 1=ok, 2=error
    message?: string;
  };
}

export interface ScopeSpans {
  scope?: { name?: string; version?: string };
  spans:  OtlpSpan[];
}

export interface ResourceSpans {
  resource?: { attributes?: KeyValue[] };
  scopeSpans: ScopeSpans[];
}

/** Root payload shape for POST /api/otel/v1/traces */
export interface OtlpTracesPayload {
  resourceSpans: ResourceSpans[];
}
