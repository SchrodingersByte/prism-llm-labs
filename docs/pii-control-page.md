# Design Recommendation — PII Control Page

> Status: **design only.** No PII control page exists today — detection/masking/residency
> are configurable **only via the API** (`PATCH /api/org`), with no UI. This doc recommends the page.
> Mount under **Settings → Compliance** (`/settings/compliance`, alongside Audit Log + Reconciliation).
> Backs the AREA 3 India-PII work (Aadhaar/PAN/GSTIN/… detection + `india_only` residency).

## 1. Purpose

One screen for a workspace admin to control how Prism handles sensitive data flowing through the gateway:
**what** it detects, **whether** it warns or blocks, **what** it masks in logs, **custom** org patterns, the
**data-residency** policy, and a window into recent **incidents**. The India/DPDP identifiers make this a
compliance requirement for Indian customers, not a nice-to-have.

## 2. Backend it talks to (already exists)

| Action | Endpoint | Fields |
|---|---|---|
| Load settings | `GET /api/org` | `data_residency_policy`, `gateway_mode`, (extend GET to also return the pii_* fields — see §7) |
| Save settings | `PATCH /api/org` | `pii_detection_enabled`, `pii_detection_action` (`warn`/`block`), `pii_masking_enabled`, `pii_mask_patterns` (string[]), `pii_custom_patterns` (`{name,pattern,enabled}[]`), `data_residency_policy` (`any`/`eu_only`/`us_only`/`india_only`) |
| Recent incidents | `GET /api/pii-incidents` | `provider, model, pii_types[], action_taken, field_paths[], created_at` |

All built-in detector types are now accepted by `pii_mask_patterns` (the zod enum derives from
`DEFAULT_PATTERNS`), so the UI can offer every type — including India/credential/medical.

## 3. The detector catalog (group for the UI)

`lib/privacy/pii-patterns.ts` defines a flat union, but the UI should present it **grouped**. Recommended
categories (match the source comments):

| Category | Types |
|---|---|
| Identity / contact | `email`, `phone`, `ssn`, `credit_card`, `ip_address` |
| Credential leaks | `aws_access_key`, `aws_secret_key`, `github_token`, `openai_api_key`, `jwt_token` |
| Government (intl.) | `passport_us`, `national_id_uk`, `iban` |
| Medical | `medical_record`, `npi_number` |
| **India (DPDP)** | `aadhaar`, `pan`, `gstin`, `ifsc`, `upi_vpa`, `voter_id_in`, `passport_in`, `driving_licence_in`, `phone_in` |

> **Recommend a tiny backend addition** (§7): export a `PII_CATALOG` (type → `{label, category, note?}`) so the
> page and the validator never drift. The India group's Aadhaar should carry a note: _"Verhoeff-checksum
> validated — only valid Aadhaar numbers are flagged."_

## 4. Layout

```
┌─ PageHeader ──────────────────────────────────────────────────────────────┐
│  Data Protection (PII)          [ Save changes ]                           │
│  Detect and mask sensitive data before it reaches model providers.         │
└────────────────────────────────────────────────────────────────────────────┘

┌─ Detection ────────────────────────────┐  ┌─ Data residency ───────────────┐
│ [x] Detect PII in requests             │  │ Provider keys must reside in:   │
│ On detection:  ( ) Warn  (•) Block     │  │  ( ) Any   ( ) EU   ( ) US      │
│ Detection always runs on all built-ins.│  │  (•) India only                 │
└────────────────────────────────────────┘  │  ⚠ 'global' keys still allowed; │
                                             │    enable strict mode for RBI.  │
┌─ Masking (in stored logs) ─────────────┐  └────────────────────────────────┘
│ [x] Mask PII in request logs           │
│  Identity      [✓ email][✓ phone][ ssn]…                                    │
│  Credentials   [✓ aws_secret_key][✓ openai_api_key]…                        │
│  India (DPDP)  [✓ aadhaar*][✓ pan][✓ ifsc][ upi_vpa][ phone_in]…   *Verhoeff │
│  (chips toggle membership in pii_mask_patterns)                             │
└────────────────────────────────────────────────────────────────────────────┘

┌─ Custom patterns ──────────────────────────────────────────────────────────┐
│  Name            Regex                          Enabled                      │
│  employee_id     EMP\d{6}                        [x]      [remove]           │
│  [ + Add pattern ]   (validate the regex client-side before save)          │
└────────────────────────────────────────────────────────────────────────────┘

┌─ Recent incidents (GET /api/pii-incidents) ────────────────────────────────┐
│  time      provider   model        types            action   fields         │
│  2m ago    anthropic  claude-…     aadhaar, phone   block    messages[2]     │
└────────────────────────────────────────────────────────────────────────────┘
```

**Components** (per CLAUDE.md conventions):
- `components/shared/PageHeader.tsx` — title + a sticky **Save** action (dirty-state aware).
- shadcn `Switch` for the two master toggles; `RadioGroup` for detection action + residency.
- Masking selector: grouped **toggle chips** (a chip per type, grouped by §3 category). Selected set ⇄
  `pii_mask_patterns`. Show the Aadhaar `*Verhoeff` footnote.
- Custom patterns: editable rows; **validate each regex with `new RegExp()` in a try/catch before enabling
  Save** (mirrors the server, which silently drops invalid patterns).
- Incidents: compact table with type pills; link out to the full audit log.

## 5. Key UX rules

- **Detection vs. masking are independent.** Detection (warn/block) runs on **all** built-ins regardless of the
  masking selection; masking only governs what's redacted in **stored logs**. Make this distinction explicit in
  copy so admins don't assume unchecking a mask chip stops detection.
- **`block` is a hard gate** — warn the admin that `block` + a noisy type (e.g. `aws_secret_key`, 40-char) can
  reject legitimate traffic. Recommend defaulting new orgs to `warn`.
- **Residency `india_only` caveat:** today `global` keys still satisfy it (consistent with eu/us). Surface the
  inline warning shown above; a future **strict** mode (reject `global` for India, per RBI localization) should
  appear here as a checkbox when implemented.
- **Save semantics:** PATCH only the changed fields; optimistic UI + toast; re-fetch on success.

## 6. Empty / first-run states

- No incidents yet → "No PII detected in the selected window. Detection is **on/off**." (reflect the toggle).
- Masking off → grey out the chip groups with an explainer ("Turn on masking to choose what's redacted").
- Detection off → a prominent banner: "PII detection is off — requests are not scanned."

## 7. Small backend follow-ups to enable this page

1. **Extend `GET /api/org`** to return the `pii_*` fields (currently it returns only `name, slug,
   data_residency_policy, gateway_mode`) so the page can hydrate without a second call.
2. **Export a `PII_CATALOG`** (`type → {label, category, note?}`) from `lib/privacy/pii-patterns.ts` for the
   grouped selector + the Aadhaar/Verhoeff note, keeping UI and detector in lockstep.
3. (Optional) A `GET /api/pii-incidents/summary` for counts-by-type to drive a small incidents sparkline.

## 8. Phasing

1. **P1:** Detection toggle + action + residency radio + Save (wire `GET`/`PATCH /api/org`). Smallest useful slice.
2. **P2:** Masking chip groups (incl. the India group) + the catalog export (§7.2).
3. **P3:** Custom patterns editor + incidents panel.
