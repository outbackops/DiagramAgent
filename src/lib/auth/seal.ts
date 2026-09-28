import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { LlmError } from "@/lib/llm/errors";

/**
 * AES-256-GCM sealing for values we hand to the browser (the session cookie
 * and the device-flow handle). The `purpose` is bound as additional
 * authenticated data so one kind of token can never be replayed as another.
 */

const KEY_SYMBOL = Symbol.for("diagram-agent.session-key");
const MIN_SECRET_LENGTH = 32;

type GlobalWithKey = typeof globalThis & { [KEY_SYMBOL]?: Buffer };

let warnedEphemeralKey = false;

function sealingKey(): Buffer {
  const secret = process.env.DIAGRAM_AGENT_SESSION_SECRET;
  if (secret) {
    if (secret.length < MIN_SECRET_LENGTH) {
      throw new LlmError("not_configured", `DIAGRAM_AGENT_SESSION_SECRET must be at least ${MIN_SECRET_LENGTH} characters.`);
    }
    return createHash("sha256").update(secret).digest();
  }
  if (process.env.NODE_ENV === "production") {
    throw new LlmError("not_configured", "Set DIAGRAM_AGENT_SESSION_SECRET (32+ random characters) to enable sign-in.");
  }
  const g = globalThis as GlobalWithKey;
  if (!g[KEY_SYMBOL]) {
    g[KEY_SYMBOL] = randomBytes(32);
    if (!warnedEphemeralKey) {
      warnedEphemeralKey = true;
      console.warn("DIAGRAM_AGENT_SESSION_SECRET is not set — using a per-process key; sign-ins reset when the server restarts.");
    }
  }
  return g[KEY_SYMBOL]!;
}

export function sessionConfigError(): string | null {
  if (process.env.NODE_ENV !== "production") return null;
  const secret = process.env.DIAGRAM_AGENT_SESSION_SECRET;
  if (!secret) return "Set DIAGRAM_AGENT_SESSION_SECRET (32+ random characters) to enable sign-in.";
  if (secret.length < MIN_SECRET_LENGTH) return `DIAGRAM_AGENT_SESSION_SECRET must be at least ${MIN_SECRET_LENGTH} characters.`;
  return null;
}

export type SealPurpose = "session" | "device-flow";

export function seal(payload: unknown, purpose: SealPurpose): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", sealingKey(), iv);
  cipher.setAAD(Buffer.from(purpose));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64url"), ciphertext.toString("base64url"), tag.toString("base64url")].join(".");
}

export function unseal<T>(sealed: string | null | undefined, purpose: SealPurpose): T | null {
  if (!sealed) return null;
  const parts = sealed.split(".");
  if (parts.length !== 4 || parts[0] !== "v1") return null;
  try {
    const [, iv, ciphertext, tag] = parts;
    const ivBytes = Buffer.from(iv, "base64url");
    const tagBytes = Buffer.from(tag, "base64url");
    if (ivBytes.length !== 12 || tagBytes.length !== 16) return null;
    const decipher = createDecipheriv("aes-256-gcm", sealingKey(), ivBytes, { authTagLength: 16 });
    decipher.setAAD(Buffer.from(purpose));
    decipher.setAuthTag(tagBytes);
    const plaintext = Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]);
    return JSON.parse(plaintext.toString("utf8")) as T;
  } catch {
    return null;
  }
}
