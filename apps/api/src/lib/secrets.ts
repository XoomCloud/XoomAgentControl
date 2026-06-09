import crypto from "node:crypto";

// ──────────────────────────────────────────────────────────────────────────
// MVP secrets encryption: AES-256-GCM envelope encryption with a master key.
//
// Production providers (Vault, Infisical, Doppler, AWS Secrets Manager) plug in
// behind the SecretsProvider interface below — only `local` is implemented for
// the MVP. The DB stores either an encrypted blob (local) or an external ref.
// ──────────────────────────────────────────────────────────────────────────

export interface SecretsProvider {
  readonly name: string;
  /** Encrypt/store a raw value, returning a reference + optional ciphertext. */
  store(opts: { ref: string; value: string }): Promise<{ externalRef: string; ciphertext?: string }>;
  /** Resolve a stored secret back to plaintext (used when dispatching commands). */
  resolve(opts: { externalRef: string; ciphertext?: string | null }): Promise<string>;
}

const ALGO = "aes-256-gcm";

function getKey(masterKeyB64?: string): Buffer {
  if (!masterKeyB64 || masterKeyB64 === "REPLACE_WITH_BASE64_32_BYTE_KEY") {
    // Deterministic dev fallback so the platform boots without config. NOT for prod.
    return crypto.createHash("sha256").update("xoomagent-dev-master-key").digest();
  }
  const key = Buffer.from(masterKeyB64, "base64");
  if (key.length !== 32) {
    throw new Error("SECRETS_MASTER_KEY must decode to exactly 32 bytes (base64)");
  }
  return key;
}

export function encryptValue(plaintext: string, masterKeyB64?: string): string {
  const key = getKey(masterKeyB64);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Format: v1:<iv>:<tag>:<ciphertext> (all base64)
  return ["v1", iv.toString("base64"), tag.toString("base64"), enc.toString("base64")].join(":");
}

export function decryptValue(blob: string, masterKeyB64?: string): string {
  const parts = blob.split(":");
  if (parts.length !== 4 || parts[0] !== "v1") {
    throw new Error("Malformed secret ciphertext");
  }
  const key = getKey(masterKeyB64);
  const iv = Buffer.from(parts[1]!, "base64");
  const tag = Buffer.from(parts[2]!, "base64");
  const enc = Buffer.from(parts[3]!, "base64");
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
}

export class LocalSecretsProvider implements SecretsProvider {
  readonly name = "local";
  constructor(private readonly masterKeyB64?: string) {}

  async store(opts: { ref: string; value: string }) {
    return { externalRef: opts.ref, ciphertext: encryptValue(opts.value, this.masterKeyB64) };
  }

  async resolve(opts: { externalRef: string; ciphertext?: string | null }) {
    if (!opts.ciphertext) throw new Error(`No local ciphertext for ${opts.externalRef}`);
    return decryptValue(opts.ciphertext, this.masterKeyB64);
  }
}

/** Generate a random URL-safe credential (used for host agent keys). */
export function generateToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString("base64url");
}
