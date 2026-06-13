/**
 * Shared PII regex patterns.
 * Imported by both pii-masker.ts (for redaction) and pii-detector.ts (for detection).
 */

import { isAadhaar } from "./verhoeff";

export type PiiPatternType =
  // Identity / contact
  | "email" | "phone" | "ssn" | "credit_card" | "ip_address"
  // Credential leaks — highest severity; these should never reach LLM providers
  | "aws_access_key" | "aws_secret_key" | "github_token" | "openai_api_key" | "jwt_token"
  // National / government identifiers
  | "passport_us" | "national_id_uk" | "iban"
  // Medical / healthcare
  | "medical_record" | "npi_number"
  // India (DPDP Act 2023) — national / financial identifiers
  | "aadhaar" | "pan" | "gstin" | "ifsc" | "upi_vpa"
  | "voter_id_in" | "passport_in" | "driving_licence_in" | "phone_in";

export interface PiiPattern {
  type: PiiPatternType;
  re:   RegExp;
  /**
   * Optional per-match validator. When present, a regex match only counts as PII
   * if this returns true — used to cut false positives on broad numeric formats
   * (e.g. Aadhaar's Verhoeff checksum). Applied by both the detector and masker.
   */
  validate?: (match: string) => boolean;
}

export const ALL_PATTERNS: PiiPattern[] = [
  {
    type: "email",
    re:   /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g,
  },
  {
    type: "phone",
    re:   /(\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}/g,
  },
  {
    type: "ssn",
    re:   /\b\d{3}-\d{2}-\d{4}\b/g,
  },
  {
    type: "credit_card",
    re:   /\b(?:\d[ -]?){13,16}\b/g,
  },
  {
    type: "ip_address",
    re:   /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b/g,
  },
  // ── Credential leak patterns — highest severity ───────────────────────────
  {
    // AWS Access Key ID — 20-char AKIA/ASIA/AIDA/AROA prefix
    type: "aws_access_key",
    re:   /\b(?:AKIA|ASIA|AIDA|AROA)[0-9A-Z]{16}\b/g,
  },
  {
    // AWS Secret Access Key — 40-char base64-ish (high FP risk; warn-only recommended)
    type: "aws_secret_key",
    re:   /(?<![A-Za-z0-9+/])[A-Za-z0-9+/]{40}(?![A-Za-z0-9+/=])/g,
  },
  {
    // GitHub personal access token (ghp_) and fine-grained (github_pat_)
    type: "github_token",
    re:   /\b(?:ghp|github_pat)_[A-Za-z0-9_]{36,}\b/g,
  },
  {
    // OpenAI API key — sk-... format (also matches sk-proj- prefix)
    type: "openai_api_key",
    re:   /\bsk-(?:proj-)?[A-Za-z0-9_\-]{20,60}\b/g,
  },
  {
    // JSON Web Token — three base64url segments separated by dots
    type: "jwt_token",
    re:   /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
  },
  // ── National / government identifiers ────────────────────────────────────
  {
    // US passport number — one letter followed by 8 digits
    type: "passport_us",
    re:   /\b[A-Z][0-9]{8}\b/g,
  },
  {
    // UK National Insurance number — e.g. AB123456C
    type: "national_id_uk",
    re:   /\b[A-CEGHJ-PR-TW-Z]{2}[0-9]{6}[A-D]\b/g,
  },
  {
    // IBAN — country code + check digits + BBAN
    type: "iban",
    re:   /\b[A-Z]{2}[0-9]{2}[A-Z0-9]{4}[0-9]{7,26}\b/g,
  },
  // ── Medical / healthcare identifiers ─────────────────────────────────────
  {
    // Medical Record Number — MRN followed by 6-10 digits
    type: "medical_record",
    re:   /\bMRN[-:\s]?[0-9]{6,10}\b/gi,
  },
  {
    // US National Provider Identifier — NPI followed by 10 digits
    type: "npi_number",
    re:   /\bNPI[-:\s]?[0-9]{10}\b/gi,
  },
  // ── India (DPDP Act 2023) national / financial identifiers ───────────────
  {
    // Aadhaar — 12 digits (first 2-9), optional 4-4-4 spacing. Verhoeff-validated
    // to reject the flood of false positives a bare 12-digit pattern would catch.
    type:     "aadhaar",
    re:       /\b[2-9]\d{3}\s?\d{4}\s?\d{4}\b/g,
    validate: isAadhaar,
  },
  {
    // PAN — 5 letters, 4 digits, 1 letter (e.g. ABCDE1234F)
    type: "pan",
    re:   /\b[A-Z]{5}[0-9]{4}[A-Z]\b/g,
  },
  {
    // GSTIN — 2-digit state + 10-char PAN + entity digit + 'Z' + checksum (15 chars)
    type: "gstin",
    re:   /\b[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]\b/g,
  },
  {
    // IFSC — bank code (4 letters) + reserved '0' + 6-char branch code
    type: "ifsc",
    re:   /\b[A-Z]{4}0[A-Z0-9]{6}\b/g,
  },
  {
    // UPI VPA — handle@bank (no dotted TLD; the lookahead avoids matching emails)
    type: "upi_vpa",
    re:   /\b[a-zA-Z0-9._\-]{2,}@[a-z]{2,}\b(?!\.[a-z])/gi,
  },
  {
    // Voter ID / EPIC — 3 letters + 7 digits
    type: "voter_id_in",
    re:   /\b[A-Z]{3}[0-9]{7}\b/g,
  },
  {
    // Indian passport — 1 letter (excl. Q/X/Z) + 7 digits
    type: "passport_in",
    re:   /\b[A-PR-WY][0-9]{7}\b/g,
  },
  {
    // Indian driving licence — SS RR YYYY NNNNNNN (state, RTO, year, serial)
    type: "driving_licence_in",
    re:   /\b[A-Z]{2}[\s-]?\d{2}[\s-]?(?:19|20)\d{2}\d{7}\b/g,
  },
  {
    // Indian mobile — optional +91, then 10 digits starting 6-9 (allow 5-5 spacing)
    type: "phone_in",
    re:   /\b(?:\+?91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}\b/g,
  },
];

export const DEFAULT_PATTERNS: PiiPatternType[] = ALL_PATTERNS.map(p => p.type);
