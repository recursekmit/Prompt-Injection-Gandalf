import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * AES-256-GCM authenticated encryption for a single short secret (a Groq key).
 * Payload is `iv:authTag:ciphertext`, each base64. GCM's auth tag is what makes
 * a tampered payload throw on decrypt rather than returning garbage.
 */
const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12; // GCM's standard nonce length.
const KEY_BYTES = 32;

function keyFrom(keyBase64: string): Buffer {
  const key = Buffer.from(keyBase64, "base64");
  if (key.length !== KEY_BYTES) {
    throw new Error("KEY_ENCRYPTION_KEY must decode to 32 bytes");
  }
  return key;
}

export function encryptSecret(plaintext: string, keyBase64: string): string {
  const key = keyFrom(keyBase64);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString("base64"), authTag.toString("base64"), ciphertext.toString("base64")].join(":");
}

export function decryptSecret(payload: string, keyBase64: string): string {
  const key = keyFrom(keyBase64);
  const parts = payload.split(":");
  if (parts.length !== 3) {
    throw new Error("Malformed secret payload");
  }
  const [iv, authTag, ciphertext] = parts.map((part) => Buffer.from(part, "base64"));
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
