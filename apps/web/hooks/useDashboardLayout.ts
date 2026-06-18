"use client";

import { useCallback, useEffect, useState } from "react";

const LS_PREFIX = "prism-dashboard-layout:";

/**
 * Per-user dashboard layout (the ordered widget id list for a view).
 *
 * localStorage is the source of truth for instant, offline-safe UX (mirrors the
 * theme provider's approach). On mount we also best-effort hydrate from the DB
 * (`/api/preferences/layout`) so the layout follows the user across devices once
 * the `dashboard_layouts` column exists; writes are fire-and-forget to the same
 * endpoint. If the column/endpoint isn't there yet, localStorage still works.
 */
export function useDashboardLayout(viewKey: "org" | "project", defaultIds: string[]) {
  const storageKey = LS_PREFIX + viewKey;
  const [ids, setIdsState] = useState<string[]>(defaultIds);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      const parsed = raw ? JSON.parse(raw) : null;
      if (Array.isArray(parsed) && parsed.length > 0) setIdsState(parsed);
    } catch { /* ignore malformed cache */ }

    fetch("/api/preferences/layout", { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        const dbIds = j?.layouts?.[viewKey];
        if (Array.isArray(dbIds) && dbIds.length > 0) {
          setIdsState(dbIds);
          try { localStorage.setItem(storageKey, JSON.stringify(dbIds)); } catch { /* quota */ }
        }
      })
      .catch(() => { /* offline / not migrated yet — localStorage already applied */ });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey, viewKey]);

  const save = useCallback((next: string[]) => {
    try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* quota */ }
    fetch("/api/preferences/layout", {
      method: "PUT",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ view: viewKey, ids: next }),
    }).catch(() => { /* best effort */ });
  }, [storageKey, viewKey]);

  const setIds = useCallback((next: string[]) => {
    setIdsState(next);
    save(next);
  }, [save]);

  const reset = useCallback(() => {
    setIdsState(defaultIds);
    try { localStorage.removeItem(storageKey); } catch { /* ignore */ }
    save(defaultIds);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey, save]);

  return { ids, setIds, reset };
}
