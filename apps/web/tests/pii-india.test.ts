/**
 * India PII coverage — AREA 3 / T3.4.
 * Aadhaar Verhoeff validation, India identifier detection + masking, and
 * india_only data residency.
 */
import { describe, it, expect } from "vitest";
import { verhoeffValid, isAadhaar } from "@/lib/privacy/verhoeff";
import { detectPII } from "@/lib/privacy/pii-detector";
import { maskPii } from "@/lib/privacy/pii-masker";
import { checkDataResidency } from "@/lib/gateway/data-residency";

// Construct a checksum-valid Aadhaar from an 11-digit payload by finding the
// Verhoeff check digit — self-validating, no hardcoded magic number.
function validAadhaar(payload11: string): string {
  for (let d = 0; d < 10; d++) {
    if (verhoeffValid(payload11 + d)) return payload11 + d;
  }
  throw new Error("unreachable: every payload has exactly one valid check digit");
}

const AADHAAR = validAadhaar("23412341234");                       // 12 digits, starts 2
const BAD_AADHAAR = AADHAAR.slice(0, 11) + ((Number(AADHAAR[11]) + 1) % 10); // wrong check digit

const types = (content: string): string[] =>
  detectPII([{ role: "user", content }]).detectedTypes;

describe("Verhoeff / Aadhaar", () => {
  it("accepts a checksum-valid Aadhaar and rejects a tampered one", () => {
    expect(verhoeffValid(AADHAAR)).toBe(true);
    expect(verhoeffValid(BAD_AADHAAR)).toBe(false);
    expect(isAadhaar(AADHAAR)).toBe(true);
    expect(isAadhaar(BAD_AADHAAR)).toBe(false);
  });

  it("rejects wrong length and 0/1-prefixed numbers", () => {
    expect(isAadhaar(AADHAAR.slice(0, 11))).toBe(false);        // 11 digits
    expect(isAadhaar("0" + AADHAAR.slice(1))).toBe(false);      // starts 0
    expect(isAadhaar("1" + AADHAAR.slice(1))).toBe(false);      // starts 1
  });
});

describe("India PII detection", () => {
  it("detects a Verhoeff-valid Aadhaar", () => {
    expect(types(`My Aadhaar is ${AADHAAR}.`)).toContain("aadhaar");
  });

  it("does NOT flag a 12-digit number that fails the Verhoeff check (FP cut)", () => {
    expect(types(`Reference number ${BAD_AADHAAR} for your order`)).not.toContain("aadhaar");
  });

  it("detects PAN, GSTIN, IFSC, Voter ID", () => {
    expect(types("PAN: ABCDE1234F")).toContain("pan");
    expect(types("GSTIN 29ABCDE1234F1Z5")).toContain("gstin");
    expect(types("branch IFSC HDFC0001234")).toContain("ifsc");
    expect(types("EPIC ABC1234567")).toContain("voter_id_in");
  });

  it("distinguishes UPI VPA from email", () => {
    expect(types("pay me at ravi@okhdfcbank")).toContain("upi_vpa");
    const mail = types("write to ravi@gmail.com");
    expect(mail).toContain("email");
    expect(mail).not.toContain("upi_vpa");
  });

  it("detects an Indian mobile number", () => {
    expect(types("call +91 98765 43210")).toContain("phone_in");
  });
});

describe("India PII masking", () => {
  it("redacts a valid Aadhaar but leaves an invalid 12-digit number intact", () => {
    expect(maskPii(`Aadhaar ${AADHAAR}`, ["aadhaar"])).toBe("Aadhaar [REDACTED:aadhaar]");
    expect(maskPii(`Ref ${BAD_AADHAAR}`, ["aadhaar"])).toBe(`Ref ${BAD_AADHAAR}`);
  });

  it("redacts PAN when enabled", () => {
    expect(maskPii("PAN ABCDE1234F", ["pan"])).toBe("PAN [REDACTED:pan]");
  });
});

describe("India data residency", () => {
  it("enforces india_only", () => {
    expect(checkDataResidency("india_only", "in").allowed).toBe(true);
    expect(checkDataResidency("india_only", "global").allowed).toBe(true);
    expect(checkDataResidency("india_only", "us").allowed).toBe(false);
  });

  it("keeps existing policies intact", () => {
    expect(checkDataResidency("us_only", "in").allowed).toBe(false);
    expect(checkDataResidency("any", "in").allowed).toBe(true);
    expect(checkDataResidency("eu_only", "eu").allowed).toBe(true);
  });
});
