export type EnforceMode = "transparent" | "warn" | "strict";

export interface EnforceOptions {
  /** Behaviour when a raw provider SDK import is detected. Default: "transparent" */
  mode?: EnforceMode;
  /** URL or path to a Prism-compatible ingest endpoint for bypass event reporting */
  reportUrl?: string;
}
