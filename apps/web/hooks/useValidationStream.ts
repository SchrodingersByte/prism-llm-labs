"use client";

import { useEffect, useRef, useState } from "react";
import type { ValidationStreamState, ValidationResult } from "@/lib/engine/types";

export function useValidationStream(jobId: string | null): ValidationStreamState {
  const [state, setState] = useState<ValidationStreamState>({
    status:       "idle",
    progress:     0,
    total:        20,
    score_so_far: 0,
  });

  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!jobId) return;

    esRef.current?.close();
    setState({ status: "running", jobId, progress: 0, total: 20, score_so_far: 0 });

    const es = new EventSource(`/api/engine/validate/${jobId}`);
    esRef.current = es;

    es.addEventListener("progress", (e: MessageEvent) => {
      const d = JSON.parse(e.data) as { n: number; total: number; score_so_far: number };
      setState(s => ({ ...s, status: "running", progress: d.n, total: d.total, score_so_far: d.score_so_far }));
    });

    es.addEventListener("done", (e: MessageEvent) => {
      const result = JSON.parse(e.data) as ValidationResult;
      setState(s => ({ ...s, status: "done", result }));
      es.close();
    });

    es.addEventListener("error", (e: MessageEvent) => {
      try {
        const d = JSON.parse(e.data) as { message: string };
        setState(s => ({ ...s, status: "error", error: d.message }));
      } catch {
        setState(s => ({ ...s, status: "error", error: "Validation failed" }));
      }
      es.close();
    });

    return () => es.close();
  }, [jobId]);

  return state;
}

/**
 * Hook for synthetic validation (Phase 3B).
 * Connects to the SSE stream from POST /api/engine/validate (mode=synthetic).
 * The caller passes a ReadableStream reader from the fetch response.
 */
export function useSyntheticValidationStream(): {
  state:  ValidationStreamState;
  run:    (params: SyntheticParams) => void;
  reset:  () => void;
} {
  const [state, setState] = useState<ValidationStreamState>({
    status: "idle", progress: 0, total: 10, score_so_far: 0,
  });
  const abortRef = useRef<AbortController | null>(null);

  function reset() {
    abortRef.current?.abort();
    setState({ status: "idle", progress: 0, total: 10, score_so_far: 0 });
  }

  async function run(params: SyntheticParams) {
    abortRef.current?.abort();
    const abort = new AbortController();
    abortRef.current = abort;

    setState({ status: "running", progress: 0, total: 10, score_so_far: 0 });

    try {
      const res = await fetch("/api/engine/validate", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ mode: "synthetic", ...params }),
        signal:  abort.signal,
      });

      if (!res.ok || !res.body) {
        setState(s => ({ ...s, status: "error", error: "Request failed" }));
        return;
      }

      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer    = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i].trim();
          if (line.startsWith("event:")) {
            const event = line.slice(6).trim();
            const dataLine = lines[i + 1]?.trim() ?? "";
            if (dataLine.startsWith("data:")) {
              const data = JSON.parse(dataLine.slice(5).trim());
              if (event === "progress") {
                setState(s => ({ ...s, progress: data.n, total: data.total }));
              } else if (event === "done") {
                setState(s => ({ ...s, status: "done", result: data }));
              } else if (event === "error") {
                setState(s => ({ ...s, status: "error", error: data.message }));
              }
            }
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setState(s => ({ ...s, status: "error", error: String(err) }));
      }
    }
  }

  return { state, run, reset };
}

interface SyntheticParams {
  // Identifies which Recommendation this run is for, so the server can
  // persist the result via recordValidationResult() — see
  // POST /api/engine/validate and lib/engine/actions.ts. Optional: omitting
  // them just means the run won't be remembered (e.g. ad-hoc exploration).
  recId?:         string;
  recType?:       string;
  recTitle?:      string;
  currentModel:   string;
  suggestedModel: string;
  providerKeyId:  string;
  feature:        string;
  stats?: {
    avg_input_tokens:   number;
    output_input_ratio: number;
    cache_hit_rate:     number;
  };
}
