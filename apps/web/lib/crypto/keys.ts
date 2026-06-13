import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

function getSecret(): Buffer {
  return Buffer.from(process.env.ENCRYPTION_SECRET!, "hex");
}

export function encryptKey(plaintext: string): string {
  const secret    = getSecret();
  const iv        = randomBytes(16);
  const cipher    = createCipheriv("aes-256-cbc", secret, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return `${iv.toString("hex")}:${encrypted.toString("hex")}`;
}

export function decryptKey(ciphertext: string): string {
  const secret    = getSecret();
  const [ivHex, encHex] = ciphertext.split(":");
  const iv        = Buffer.from(ivHex, "hex");
  const decipher  = createDecipheriv("aes-256-cbc", secret, iv);
  return Buffer.concat([
    decipher.update(Buffer.from(encHex, "hex")),
    decipher.final(),
  ]).toString("utf8");
}
