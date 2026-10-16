import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * AES-256-GCM for secrets at rest (OAuth refresh tokens). The key is 32 bytes,
 * base64, from the environment — never stored beside what it protects. GCM's
 * tag makes a tampered ciphertext fail to decrypt rather than decrypt to
 * garbage.
 */

export interface Sealed {
  ciphertext: string;
  iv: string;
  tag: string;
}

export function parseKey(base64: string | undefined): Buffer | null {
  if (!base64) return null;
  const key = Buffer.from(base64, "base64");
  return key.length === 32 ? key : null;
}

export function seal(plaintext: string, key: Buffer): Sealed {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
  };
}

export function open(sealed: Sealed, key: Buffer): string {
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(sealed.iv, "base64"));
  decipher.setAuthTag(Buffer.from(sealed.tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(sealed.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
