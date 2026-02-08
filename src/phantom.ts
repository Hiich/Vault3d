import crypto from "crypto";
import nacl from "tweetnacl";
import bs58 from "bs58";
import { entropyToMnemonic } from "bip39";

// --- Types ---

export interface PhantomResult {
  mnemonic?: string;
  keypairs: Array<{
    publicKey: string;
    secretKey: string;
  }>;
  raw?: unknown;
}

interface EncryptedContent {
  encrypted: string; // base58
  nonce: string; // base58
  salt: string; // base58
  kdf: "pbkdf2" | "scrypt";
  iterations?: number;
  digest?: string;
}

interface PhantomEncryptionKey {
  encryptedKey: EncryptedContent;
  version?: number;
}

interface PhantomVaultEntry {
  content: EncryptedContent;
  version?: number;
}

export interface PhantomVaultData {
  encryptionKey: PhantomEncryptionKey;
  seeds: PhantomVaultEntry[];
  privateKeys: PhantomVaultEntry[];
}

// --- LevelDB key prefixes ---
// Actual keys have a leading dot and seed/privateKey keys have hash suffixes:
//   .phantom-labs.encryption.encryptionKey
//   .phantom-labs.vault.seed.<hash>
//   .phantom-labs.vault.privateKey.<hash>

const KEY_ENCRYPTION = ".phantom-labs.encryption.encryptionKey";
const PREFIX_SEED = ".phantom-labs.vault.seed.";
const PREFIX_PRIVATE_KEY = ".phantom-labs.vault.privateKey.";

/**
 * Parse a LevelDB value as JSON, handling optional version-0
 * `{ expiry: ..., value: "..." }` envelopes.
 */
function parseEntry<T>(raw: string): T | null {
  try {
    const outer = JSON.parse(raw);

    // Version 0 format: value is a JSON string inside a wrapper
    if (typeof outer.value === "string") {
      try {
        return JSON.parse(outer.value) as T;
      } catch {
        return outer.value as unknown as T;
      }
    }

    return outer as T;
  } catch {
    return null;
  }
}

/**
 * Search LevelDB entries for the Phantom encrypted vault components.
 * Looks up the encryption key by exact name, and finds all seed/privateKey
 * entries by prefix (they have hash suffixes).
 */
export function findVault(
  entries: Map<string, string>
): PhantomVaultData | null {
  // Find encryption key (required)
  const encKeyRaw = entries.get(KEY_ENCRYPTION);
  if (!encKeyRaw) return null;

  const encryptionKey = parseEntry<PhantomEncryptionKey>(encKeyRaw);
  if (!encryptionKey?.encryptedKey?.encrypted) return null;

  // Find all seed entries (prefix match)
  const seeds: PhantomVaultEntry[] = [];
  const privateKeys: PhantomVaultEntry[] = [];

  for (const [key, value] of entries) {
    if (key.startsWith(PREFIX_SEED)) {
      const entry = parseEntry<PhantomVaultEntry>(value);
      if (entry?.content?.encrypted) seeds.push(entry);
    } else if (key.startsWith(PREFIX_PRIVATE_KEY)) {
      const entry = parseEntry<PhantomVaultEntry>(value);
      if (entry?.content?.encrypted) privateKeys.push(entry);
    }
  }

  if (seeds.length === 0 && privateKeys.length === 0) {
    return null;
  }

  return { encryptionKey, seeds, privateKeys };
}

// --- Key derivation ---

/**
 * Derive a 32-byte key via PBKDF2 or scrypt.
 * Password can be a UTF-8 string (stage 1) or raw bytes (stage 2).
 */
function deriveKey(
  password: string | Uint8Array,
  enc: EncryptedContent
): Buffer {
  const saltBuf = Buffer.from(bs58.decode(enc.salt));
  const passwordInput =
    typeof password === "string" ? Buffer.from(password, "utf8") : password;

  if (enc.kdf === "scrypt") {
    return crypto.scryptSync(passwordInput, saltBuf, 32, {
      N: 4096,
      r: 8,
      p: 1,
    });
  }

  // Default: PBKDF2
  return crypto.pbkdf2Sync(
    passwordInput,
    saltBuf,
    enc.iterations ?? 10000,
    32,
    enc.digest ?? "sha256"
  );
}

/**
 * Decrypt a NaCl secretbox payload.
 * All fields (encrypted, nonce) are base58-encoded.
 */
function decryptBox(
  enc: EncryptedContent,
  key: Uint8Array
): Uint8Array | null {
  const encrypted = bs58.decode(enc.encrypted);
  const nonce = bs58.decode(enc.nonce);
  return nacl.secretbox.open(encrypted, nonce, key);
}

// --- Two-stage decryption ---

interface DecryptedVault {
  seeds: unknown[];
  privateKeys: unknown[];
}

/**
 * Decrypt the Phantom vault using two-stage decryption:
 *   Stage 1: password → derive key → decrypt master key
 *   Stage 2: master key → derive key → decrypt each vault entry
 */
export async function decryptVault(
  vaultData: PhantomVaultData,
  password: string
): Promise<DecryptedVault> {
  // Stage 1: Decrypt the master key
  const stage1Enc = vaultData.encryptionKey.encryptedKey;
  const stage1Key = deriveKey(password, stage1Enc);
  const masterKeyBytes = decryptBox(stage1Enc, new Uint8Array(stage1Key));

  if (!masterKeyBytes) {
    throw new Error(
      "Decryption failed — wrong password or unsupported vault format (stage 1: master key)"
    );
  }

  const result: DecryptedVault = { seeds: [], privateKeys: [] };

  // Stage 2: Decrypt each seed entry
  for (const seedEntry of vaultData.seeds) {
    const seedEnc = seedEntry.content;
    const stage2Key = deriveKey(masterKeyBytes, seedEnc);
    const seedBytes = decryptBox(seedEnc, new Uint8Array(stage2Key));

    if (!seedBytes) {
      throw new Error("Decryption failed — stage 2 seed decryption failed");
    }

    const text = Buffer.from(seedBytes).toString("utf8");
    try {
      result.seeds.push(JSON.parse(text));
    } catch {
      result.seeds.push(text);
    }
  }

  // Stage 2: Decrypt each privateKey entry
  for (const pkEntry of vaultData.privateKeys) {
    const pkEnc = pkEntry.content;
    const stage2Key = deriveKey(masterKeyBytes, pkEnc);
    const pkBytes = decryptBox(pkEnc, new Uint8Array(stage2Key));

    if (!pkBytes) {
      throw new Error(
        "Decryption failed — stage 2 privateKey decryption failed"
      );
    }

    const text = Buffer.from(pkBytes).toString("utf8");
    try {
      result.privateKeys.push(JSON.parse(text));
    } catch {
      result.privateKeys.push(text);
    }
  }

  return result;
}

// --- Key extraction ---

/**
 * Convert an entropy object `{ "0": byte, "1": byte, ... }` to a Uint8Array.
 */
function entropyObjToBytes(obj: Record<string, number>): Uint8Array {
  const indices = Object.keys(obj)
    .map(Number)
    .filter((n) => !isNaN(n))
    .sort((a, b) => a - b);
  const bytes = new Uint8Array(indices.length);
  for (let i = 0; i < indices.length; i++) {
    bytes[i] = obj[String(indices[i])]!;
  }
  return bytes;
}

/**
 * Extract a single keypair from a decrypted privateKey object.
 */
function extractKeypair(
  pkObj: Record<string, unknown>
): { publicKey: string; secretKey: string } | null {
  // Format: { privateKey: { data: [byte, ...] } }
  if (pkObj.privateKey && typeof pkObj.privateKey === "object") {
    const inner = pkObj.privateKey as Record<string, unknown>;
    if (Array.isArray(inner.data)) {
      const keyBytes = new Uint8Array(inner.data as number[]);
      // Ed25519 keypair is 64 bytes: first 32 = secret, last 32 = public
      if (keyBytes.length === 64) {
        return {
          publicKey: bs58.encode(keyBytes.slice(32)),
          secretKey: bs58.encode(keyBytes),
        };
      }
      return {
        publicKey: "(unknown)",
        secretKey: bs58.encode(keyBytes),
      };
    }
  }
  return null;
}

/**
 * Extract keys from all decrypted Phantom vault entries.
 * Handles:
 *   - Seeds: entropy dict → BIP39 mnemonic
 *   - PrivateKeys: { privateKey: { data: [...] } } → base58 Solana key
 */
export function extractKeys(decrypted: DecryptedVault): PhantomResult {
  const result: PhantomResult = { keypairs: [] };

  // Extract mnemonic from first seed that has entropy
  for (const seed of decrypted.seeds) {
    if (result.mnemonic) break;

    if (seed && typeof seed === "object") {
      const seedObj = seed as Record<string, unknown>;

      if (seedObj.entropy && typeof seedObj.entropy === "object") {
        try {
          const entropyBytes = entropyObjToBytes(
            seedObj.entropy as Record<string, number>
          );
          const hexEntropy = Buffer.from(entropyBytes).toString("hex");
          result.mnemonic = entropyToMnemonic(hexEntropy);
        } catch {
          result.raw = seed;
        }
      } else if (typeof seedObj.mnemonic === "string") {
        result.mnemonic = seedObj.mnemonic;
      }
    }
  }

  // Extract keypairs from all privateKey entries
  for (const pk of decrypted.privateKeys) {
    if (pk && typeof pk === "object") {
      const keypair = extractKeypair(pk as Record<string, unknown>);
      if (keypair) result.keypairs.push(keypair);
    }
  }

  // If we got nothing, dump raw
  if (!result.mnemonic && result.keypairs.length === 0 && !result.raw) {
    result.raw = decrypted;
  }

  return result;
}
