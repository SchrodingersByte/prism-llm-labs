"use client";

import { useEffect, useRef, useState } from "react";

export interface LiveOverviewKpis {
  spend_usd: number;
  ts:        string;
}

export interface LiveBudgetStatus {
  spend_usd:       number;
  limit_usd:       number | null;
  utilization_pct: number | null;
  budget_status:   "on_track" | "at_risk" | "over_budget";
  enforce_hard:    boolean;
}

export interface LiveVelocity {
  cost_per_min:   number;
  spike_multiple: number;
  window_start:   string;
}

export interface LiveAlerts {
  count: number;
}

export interface MetricsStreamState {
  kpis:       LiveOverviewKpis | null;
  budget:     LiveBudgetStatus | null;
  velocity:   LiveVelocity     | null;
  alerts:     LiveAlerts       | null;
  connected:  boolean;
  lastUpdate: number | null;
}

/**
 * Subscribe to the real-time metrics SSE stream.
 * EventSource auto-reconnects on disconnect.
 */
export function useMetricsStream(): MetricsStreamState {
  const [state, setState] = useState<MetricsStreamState>({
    kpis: null, budget: null, velocity: null, alerts: null,
    connected: false, lastUpdate: null,
  });

  // Use ref so the effect doesn't re-run on state change
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    function connect() {
      if (esRef.current) esRef.current.close();

      const es = new EventSource("/api/metrics/stream");
      esRef.current = es;

      es.addEventListener("open", () => {
        setState(s => ({ ...s, connected: true }));
      });

      es.addEventListener("overview_kpis", (e: MessageEvent) => {
        setState(s => ({
          ...s,
          kpis:       JSON.parse(e.data) as LiveOverviewKpis,
          lastUpdate: Date.now(),
        }));
      });

      es.addEventListener("budget_status", (e: MessageEvent) => {
        setState(s => ({
          ...s,
          budget:     JSON.parse(e.data) as LiveBudgetStatus,
          lastUpdate: Date.now(),
        }));
      });

      es.addEventListener("velocity", (e: MessageEvent) => {
        setState(s => ({
          ...s,
          velocity:   JSON.parse(e.data) as LiveVelocity,
          lastUpdate: Date.now(),
        }));
      });

      es.addEventListener("active_alerts", (e: MessageEvent) => {
        setState(s => ({
          ...s,
          alerts:     JSON.parse(e.data) as LiveAlerts,
          lastUpdate: Date.now(),
        }));
      });

      es.addEventListener("error", () => {
        setState(s => ({ ...s, connected: false }));
        // EventSource will auto-reconnect; we mark as disconnected briefly
        setTimeout(() => {
          if (esRef.current?.readyState === EventSource.CLOSED) {
            connect();
          }
        }, 3_000);
      });
    }

    connect();
    return () => { esRef.current?.close(); };
  }, []);

  return state;
}
