import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { config } from "../config";

function key(): Buffer {
  return createHash("sha256")
    .update(config.ENCRYPTION_KEY ?? `token-key:${config.JWT_SECRET}`)
    .digest();
}

/** AES-256-GCM: "iv.tag.ciphertext" (base64url) */
export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString("base64url")).join(".");
}

export function decrypt(payload: string): string {
  const [iv, tag, data] = payload.split(".").map((p) => Buffer.from(p, "base64url"));
  const decipher = createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}
