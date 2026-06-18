# Prism — Design System & Template

> **Status:** Source of truth for visual/UI decisions. Pairs with [`frontend-build-roadmap.md`](./frontend-build-roadmap.md) (scope/IA) — this doc governs *how* every page looks and is composed.
> **Locked:** 2026-06-16 · **Scheme:** Teal + Coral (two-color), light + dark.

## 1. Principles
- **Two colors, on a neutral spine.** Teal = the workhorse (primary actions, active nav, main data series, "good"). Coral = **signal only** (anomalies, firing alerts, budget breaches, cost-going-up, destructive). Never decorative coral.
- **Editorial-ledger type.** Serif display for headings, **monospaced tabular numerals** for every figure, sans for body.
- **Flat, hairline surfaces.** One colored rule per card (teal top-rule; coral when it needs attention). No shadows, no glows, no gradients on data surfaces.
- **Calm density.** Information-dense for FinOps, but quiet. One density system per page.
- **Reuse, don't reinvent.** `components/ui/*` (shadcn), `components/patterns/*`, `components/charts/*`. Never hand-edit `ui/*`.

## 2. Color tokens
Defined as HSL triples in `globals.css` (`:root` light, `.dark` dark). Use the **semantic** tokens, never raw hex.

| Token | Role | Light | Dark |
|---|---|---|---|
| `--background` | app frame | `#FAFBFB` | `#0A0D0E` |
| `--card` | surfaces | `#FFFFFF` | `#121A1B` |
| `--border` | hairlines | `#E4E8E8` | `#20292B` |
| `--foreground` | text | `#14201F` | `#E9F0EF` |
| `--muted-foreground` | secondary text | `#5F6E6E` | `#8A9A9A` |
| `--primary` (teal) | actions, active nav, main series | `#0E9486` | `#27BBAB` |
| `--signal` / `--destructive` (coral) | attention + destructive | `#FF6B5C` | `#FF7E70` |

Usage: `bg-background`, `bg-card`, `text-foreground`, `text-muted-foreground`, `border-border`, `bg-primary`/`text-primary`, and the `.signal` / `text-[hsl(var(--signal))]` utilities for coral. Charts read `--viz-*` (teal-led).

## 3. Typography
- `--font-sans` — Inter (UI/body).
- `--font-serif` — display headings (`PageHeader` title, section titles, hero numbers' labels).
- `--font-mono` — **all numerals/metrics, IDs, timestamps, code**; pair with `.tabular` (tabular-nums) so digits don't jitter.

## 4. Shape, spacing, density
- Radius: `--radius: 0.5rem` baseline (`rounded-md`/`rounded-lg`).
- Card: `.dash-card` (hairline border + `bg-card`) + a single rule — `.card-rule` (teal top hairline) or `.card-rule-signal` (coral) when flagging. `card-glow-*` is **deprecated** (kept only for not-yet-rebuilt pages).
- Density: comfortable `gap-6 p-6` or compact `gap-4 p-4` — pick one per page. Icons: Lucide `h-4 w-4` (nav/inline) / `h-5 w-5`.

## 5. Navigation pattern (the rule)
**The sidebar holds 2 levels max (group → item); the 3rd level becomes tabs.**
- **Sidebar** (`components/layout/Sidebar.tsx`): floating panel, profile header, **collapsible groups** (Analytics · Quality & Intel · Observability · Operations), coral badges, gear → Settings, pinned **New project** CTA. Collapses to an icon rail. Org tier swaps to the project tier when inside a project.
- **Topbar** (`components/layout/Topbar.tsx`): Supabase-style — Org / Project / scope switchers on the left; **Feedback · Search (⌘K) · Setup guide · Notifications · Theme · Account** on the right.
- **Page tabs** (`components/layout/PageTabs.tsx`): 3rd-level sub-routes render as a top tab bar under the page header (Spend → Cost/Attribution/…, project Observability → Logs/Sessions/Traces/Agents, API Keys → Keys/Caps/Requests). Tab sets live in `lib/nav.ts`.
- **Settings & Account** live in their **own area** (gear / avatar), each a tabbed shell — not in the primary sidebar.

Decide nest-vs-tab: switching between sibling views of the same thing → **tabs**; a distinct destination → **sidebar item**; never deeper than 2 levels in the sidebar.

## 6. Page composition recipe
Client component + `@tanstack/react-query` `useQuery` + `apiGet` from `@/lib/api/client`. Compose with `PageHeader` · `KpiCard` (color prop) · `ChartCard` · `DataTable` · `EmptyState` · `StatusBadge` · `Dialog`/`Sheet` for panels. Tabbed sections: the **layout** renders `PageHeader` + `PageTabs`; the child page renders content only. Dashboard data: fetch with `next: { revalidate: 30 }`, Suspense skeletons — never `useEffect` for initial data.

## 7. RBAC gating (mirror the server)
Gate write controls with `useCanManage()` / `useRole()` (mirrors `lib/supabase/auth.ts`: `canManage` = owner||admin, `canWrite` = owner||admin||developer, `isOwner` = billing/ownership). Nav items hide via the `roles` field. **No per-domain gating** — revenue/payloads are open to all roles in scope.

## 8. States (always design these)
Every surface ships **loading** (Skeleton), **empty** (`EmptyState`), **first-run/activation** (new orgs with no events → activation checklist, not zeros), and **error**. Many features start empty until capture/crons run — that's a designed state, not a bug.

## 9. Don't
- Coral as decoration; multiple accent colors fighting.
- Raw hex on foundational surfaces (use tokens).
- Shadows/glassmorphism/gradients on data surfaces; nested cards-in-cards.
- 3rd-level routes in the sidebar (use tabs); page nav deeper than 2 levels.
- `useEffect` + client fetch for initial dashboard data.
