import crypto from "crypto";
import {
  deriveAddressesFromMnemonic,
  deriveAddressFromPrivateKey,
} from "./evm";

export interface MetaMaskVault {
  data: string; // base64
  iv: string; // base64
  salt: string; // base64
  keyMetadata?: {
    algorithm: string;
    params: {
      iterations: number;
    };
  };
}

interface HDKeyTreeData {
  mnemonic: number[] | string;
  numberOfAccounts?: number;
  hdPath?: string;
}

interface MetaMaskKeyring {
  type: string;
  data: HDKeyTreeData | string[];
}

export interface MetaMaskResult {
  hdWallets: Array<{ mnemonic: string; accounts: number; addresses: string[] }>;
  importedKeys: Array<{ privateKey: string; address: string }>;
}

/**
 * Search LevelDB entries for the MetaMask vault JSON.
 * The vault is typically nested inside a large state blob under KeyringController.
 */
export function findVault(entries: Map<string, string>): MetaMaskVault | null {
  for (const [, value] of entries) {
    // Try to find vault inside the extension state blob
    if (value.includes('"vault"')) {
      try {
        const parsed = JSON.parse(value);
        const vaultStr =
          parsed?.KeyringController?.vault ??
          parsed?.data?.KeyringController?.vault ??
          parsed?.vault;
        if (vaultStr) {
          return JSON.parse(vaultStr);
        }
      } catch {}
    }

    // Also try matching raw vault shape directly
    if (
      value.includes('"data"') &&
      value.includes('"iv"') &&
      value.includes('"salt"')
    ) {
      try {
        const parsed = JSON.parse(value);
        if (parsed.data && parsed.iv && parsed.salt) {
          return parsed as MetaMaskVault;
        }
      } catch {}
    }
  }
  return null;
}

/**
 * Decrypt a MetaMask vault with the user's password.
 * Uses PBKDF2-SHA256 for key derivation and AES-256-GCM for decryption.
 */
export async function decryptVault(
  vault: MetaMaskVault,
  password: string
): Promise<MetaMaskKeyring[]> {
  const salt = Buffer.from(vault.salt, "base64");
  const iv = Buffer.from(vault.iv, "base64");
  const encryptedData = Buffer.from(vault.data, "base64");

  // Newer MetaMask versions use 600k iterations; older use 10k
  const iterations = vault.keyMetadata?.params?.iterations ?? 10000;

  const key = crypto.pbkdf2Sync(password, salt, iterations, 32, "sha256");

  // WebCrypto AES-GCM appends the 16-byte auth tag to the ciphertext
  const ciphertext = encryptedData.subarray(0, encryptedData.length - 16);
  const authTag = encryptedData.subarray(encryptedData.length - 16);

  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);

  return JSON.parse(decrypted.toString("utf8"));
}

/**
 * Pull mnemonics and imported private keys out of decrypted keyrings.
 */
export function extractKeys(keyrings: MetaMaskKeyring[]): MetaMaskResult {
  const result: MetaMaskResult = { hdWallets: [], importedKeys: [] };

  for (const keyring of keyrings) {
    if (keyring.type === "HD Key Tree") {
      const data = keyring.data as HDKeyTreeData;
      if (data.mnemonic) {
        const mnemonic = Array.isArray(data.mnemonic)
          ? Buffer.from(data.mnemonic).toString("utf8")
          : String(data.mnemonic);
        const accounts = data.numberOfAccounts ?? 1;
        const addresses = deriveAddressesFromMnemonic(mnemonic, accounts);
        result.hdWallets.push({ mnemonic, accounts, addresses });
      }
    } else if (keyring.type === "Simple Key Pair") {
      for (const hexKey of keyring.data as string[]) {
        const address = deriveAddressFromPrivateKey(hexKey);
        result.importedKeys.push({ privateKey: hexKey, address });
      }
    }
  }

  return result;
}
