/**
 * Verhoeff checksum — validates Aadhaar (India's 12-digit national ID).
 *
 * Aadhaar's 12th digit is a Verhoeff check digit over the first 11. Validating it
 * rejects the overwhelming majority of random 12-digit strings, which is essential
 * because a bare `\d{12}` pattern would false-positive on order numbers, phone
 * numbers, timestamps, etc. https://en.wikipedia.org/wiki/Verhoeff_algorithm
 */

// Multiplication table for the dihedral group D5.
const D = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];

// Permutation table.
const P = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];

/** True if the digit string (non-digits ignored) passes the Verhoeff checksum. */
export function verhoeffValid(input: string): boolean {
  const digits = input.replace(/\D/g, "");
  if (digits.length < 2) return false;
  let c = 0;
  for (let i = 0; i < digits.length; i++) {
    const d = digits.charCodeAt(digits.length - 1 - i) - 48; // process least-significant first
    c = D[c]![P[i % 8]![d]!]!;
  }
  return c === 0;
}

/** Aadhaar: exactly 12 digits, not starting 0/1, with a valid Verhoeff check digit. */
export function isAadhaar(input: string): boolean {
  const digits = input.replace(/\D/g, "");
  if (digits.length !== 12) return false;
  if (digits[0] === "0" || digits[0] === "1") return false;
  return verhoeffValid(digits);
}
