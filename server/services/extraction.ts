import fs from "fs-extra";
import { discoverProfiles, getExtensionDataPath, EXTENSION_IDS } from "../../src/config.ts";
import { readAllEntries } from "../../src/leveldb-reader.ts";
import * as metamask from "../../src/metamask.ts";
import * as phantom from "../../src/phantom.ts";
import { deriveAddressesFromMnemonic, deriveAddressFromPrivateKey } from "../../src/evm.ts";
import { insertWallet, insertAddress } from "../db.ts";

export interface ExtractionResult {
  wallets: number;
  addresses: number;
  errors: string[];
}

/**
 * Extract wallets from all browser profiles.
 *
 * 1. Discovers profiles via src/config.ts
 * 2. For each profile, reads LevelDB entries via src/leveldb-reader.ts
 * 3. Decrypts MetaMask vaults (if password provided) via src/metamask.ts
 * 4. Decrypts Phantom vaults (if password provided) via src/phantom.ts
 * 5. Derives EVM addresses from MetaMask via src/evm.ts
 * 6. Persists everything to SQLite via server/db.ts
 */
export async function extractWallets(options: {
  metamaskPassword?: string;
  phantomPassword?: string;
}): Promise<ExtractionResult> {
  const errors: string[] = [];
  let walletCount = 0;
  let addressCount = 0;

  let profiles: string[];
  try {
    profiles = await discoverProfiles();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { wallets: 0, addresses: 0, errors: [`Failed to discover profiles: ${msg}`] };
  }

  for (const profile of profiles) {
    // --- MetaMask ---
    if (options.metamaskPassword) {
      const mmPath = getExtensionDataPath(profile, EXTENSION_IDS.METAMASK);
      const mmExists = await fs.pathExists(mmPath);

      if (mmExists) {
        try {
          const entries = await readAllEntries(mmPath);
          const vault = metamask.findVault(entries);

          if (vault) {
            const keyrings = await metamask.decryptVault(vault, options.metamaskPassword);
            const result = metamask.extractKeys(keyrings);

            // HD wallets
            for (const hd of result.hdWallets) {
              const walletId = insertWallet({
                type: "metamask_hd",
                profile,
                mnemonic: hd.mnemonic,
              });
              walletCount++;

              // Derive and insert EVM addresses
              const addresses = deriveAddressesFromMnemonic(hd.mnemonic, hd.accounts);
              for (let i = 0; i < addresses.length; i++) {
                const addr = addresses[i]!;
                insertAddress({
                  wallet_id: walletId,
                  address: addr,
                  chain_type: "evm",
                  derivation_index: i,
                });
                addressCount++;
              }
            }

            // Imported keys
            for (const imported of result.importedKeys) {
              const hexKey = imported.privateKey.startsWith("0x")
                ? imported.privateKey
                : `0x${imported.privateKey}`;

              const walletId = insertWallet({
                type: "metamask_imported",
                profile,
                private_key: hexKey,
              });
              walletCount++;

              const address = deriveAddressFromPrivateKey(imported.privateKey);
              insertAddress({
                wallet_id: walletId,
                address,
                chain_type: "evm",
              });
              addressCount++;
            }
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          errors.push(`[${profile}] MetaMask: ${msg}`);
        }
      }
    }

    // --- Phantom ---
    if (options.phantomPassword) {
      const phPath = getExtensionDataPath(profile, EXTENSION_IDS.PHANTOM);
      const phExists = await fs.pathExists(phPath);

      if (phExists) {
        try {
          const entries = await readAllEntries(phPath);
          const vaultData = phantom.findVault(entries);

          if (vaultData) {
            const decrypted = await phantom.decryptVault(vaultData, options.phantomPassword);
            const result = phantom.extractKeys(decrypted);

            // Seed (mnemonic)
            if (result.mnemonic) {
              insertWallet({
                type: "phantom_seed",
                profile,
                mnemonic: result.mnemonic,
              });
              walletCount++;

              // Phantom seeds are Solana-based but we don't derive addresses
              // from the mnemonic here (the existing code doesn't do Solana derivation).
              // The associated keypairs will be separate entries below.
            }

            // Keypairs
            for (const kp of result.keypairs) {
              const walletId = insertWallet({
                type: "phantom_keypair",
                profile,
                private_key: kp.secretKey,
              });
              walletCount++;

              insertAddress({
                wallet_id: walletId,
                address: kp.publicKey,
                chain_type: "solana",
              });
              addressCount++;
            }
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          errors.push(`[${profile}] Phantom: ${msg}`);
        }
      }
    }
  }

  return { wallets: walletCount, addresses: addressCount, errors };
}

/**
 * Extract wallets from a single profile with per-profile passwords.
 */
export async function extractProfile(options: {
  profile: string;
  metamaskPassword?: string;
  phantomPassword?: string;
}): Promise<ExtractionResult> {
  const errors: string[] = [];
  let walletCount = 0;
  let addressCount = 0;
  const profile = options.profile;

  // --- MetaMask ---
  if (options.metamaskPassword) {
    const mmPath = getExtensionDataPath(profile, EXTENSION_IDS.METAMASK);
    const mmExists = await fs.pathExists(mmPath);

    if (mmExists) {
      try {
        const entries = await readAllEntries(mmPath);
        const vault = metamask.findVault(entries);

        if (vault) {
          const keyrings = await metamask.decryptVault(vault, options.metamaskPassword);
          const result = metamask.extractKeys(keyrings);

          for (const hd of result.hdWallets) {
            const walletId = insertWallet({
              type: "metamask_hd",
              profile,
              mnemonic: hd.mnemonic,
            });
            walletCount++;

            const addresses = deriveAddressesFromMnemonic(hd.mnemonic, hd.accounts);
            for (let i = 0; i < addresses.length; i++) {
              const addr = addresses[i]!;
              insertAddress({
                wallet_id: walletId,
                address: addr,
                chain_type: "evm",
                derivation_index: i,
              });
              addressCount++;
            }
          }

          for (const imported of result.importedKeys) {
            const hexKey = imported.privateKey.startsWith("0x")
              ? imported.privateKey
              : `0x${imported.privateKey}`;

            const walletId = insertWallet({
              type: "metamask_imported",
              profile,
              private_key: hexKey,
            });
            walletCount++;

            const address = deriveAddressFromPrivateKey(imported.privateKey);
            insertAddress({
              wallet_id: walletId,
              address,
              chain_type: "evm",
            });
            addressCount++;
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`[${profile}] MetaMask: ${msg}`);
      }
    }
  }

  // --- Phantom ---
  if (options.phantomPassword) {
    const phPath = getExtensionDataPath(profile, EXTENSION_IDS.PHANTOM);
    const phExists = await fs.pathExists(phPath);

    if (phExists) {
      try {
        const entries = await readAllEntries(phPath);
        const vaultData = phantom.findVault(entries);

        if (vaultData) {
          const decrypted = await phantom.decryptVault(vaultData, options.phantomPassword);
          const result = phantom.extractKeys(decrypted);

          if (result.mnemonic) {
            insertWallet({
              type: "phantom_seed",
              profile,
              mnemonic: result.mnemonic,
            });
            walletCount++;
          }

          for (const kp of result.keypairs) {
            const walletId = insertWallet({
              type: "phantom_keypair",
              profile,
              private_key: kp.secretKey,
            });
            walletCount++;

            insertAddress({
              wallet_id: walletId,
              address: kp.publicKey,
              chain_type: "solana",
            });
            addressCount++;
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`[${profile}] Phantom: ${msg}`);
      }
    }
  }

  return { wallets: walletCount, addresses: addressCount, errors };
}
