"use client";

import { createContext, useContext } from "react";
import type { NavRole } from "@/lib/nav";

/** Client-side mirror of the server-resolved org role, for role-gating UI. */
const RoleContext = createContext<NavRole>("developer");

export function RoleProvider({ role, children }: { role: NavRole; children: React.ReactNode }) {
  return <RoleContext.Provider value={role}>{children}</RoleContext.Provider>;
}

export function useRole(): NavRole {
  return useContext(RoleContext);
}

/** owner or administrator — the org-management gate (mirrors AuthContext.canManage). */
export function useCanManage(): boolean {
  const role = useContext(RoleContext);
  return role === "owner" || role === "administrator";
}
