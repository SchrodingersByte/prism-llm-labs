"use client";

import { useQueryStates } from "nuqs";
import { scopeParsers, type Scope } from "@/lib/scope";

/**
 * Read + update the global dashboard scope from the URL. Uses shallow history
 * replace so changing a filter updates the URL without an RSC round-trip —
 * widgets refetch because their react-query keys include the scope.
 */
export function useScope() {
  const [scope, setScope] = useQueryStates(scopeParsers, {
    history: "replace",
    shallow: true,
  });
  return { scope: scope as Scope, setScope };
}
