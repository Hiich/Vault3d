import fs from "fs-extra";
import {
  discoverAll,
  getExtensionDataPathForBrowser,
  WALLET_EXTENSIONS,
  BROWSERS,
} from "../../src/config.ts";
import type { DiscoveryResult } from "../../src/config.ts";
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
 * Merge legacy password fields into a passwords map.
 */
function buildPasswordMap(options: {
  passwords?: Record<string, string>;
  metamaskPassword?: string;
  phantomPassword?: string;
}): Record<string, string> {
  const map: Record<string, string> = { ...(options.passwords ?? {}) };
  // Legacy field support
  if (options.metamaskPassword && !map.metamask) {
    map.metamask = options.metamaskPassword;
  }
  if (options.phantomPassword && !map.phantom) {
    map.phantom = options.phantomPassword;
  }
  return map;
}

/**
 * Process a single wallet extension from a profile using the appropriate parser.
 */
async function processWallet(opts: {
  dataPath: string;
  slug: string;
  name: string;
  parser: "metamask" | "phantom";
  password: string;
  browserName: string;
  profileName: string;
}): Promise<{ wallets: number; addresses: number; errors: string[] }> {
  let walletCount = 0;
  let addressCount = 0;
  const errors: string[] = [];
  const profile = `${opts.browserName}/${opts.profileName}`;

  const exists = await fs.pathExists(opts.dataPath);
  if (!exists) return { wallets: 0, addresses: 0, errors: [] };

  try {
    const entries = await readAllEntries(opts.dataPath);

    if (opts.parser === "metamask") {
      const vault = metamask.findVault(entries);
      if (!vault) return { wallets: 0, addresses: 0, errors: [] };

      const keyrings = await metamask.decryptVault(vault, opts.password);
      const result = metamask.extractKeys(keyrings);

      // HD wallets
      for (const hd of result.hdWallets) {
        const walletId = insertWallet({
          type: `${opts.slug}_hd`,
          profile,
          browser: opts.browserName,
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

      // Imported keys
      for (const imported of result.importedKeys) {
        const hexKey = imported.privateKey.startsWith("0x")
          ? imported.privateKey
          : `0x${imported.privateKey}`;

        const walletId = insertWallet({
          type: `${opts.slug}_imported`,
          profile,
          browser: opts.browserName,
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
    } else {
      // phantom parser
      const vaultData = phantom.findVault(entries);
      if (!vaultData) return { wallets: 0, addresses: 0, errors: [] };

      const decrypted = await phantom.decryptVault(vaultData, opts.password);
      const result = phantom.extractKeys(decrypted);

      if (result.mnemonic) {
        insertWallet({
          type: `${opts.slug}_seed`,
          profile,
          browser: opts.browserName,
          mnemonic: result.mnemonic,
        });
        walletCount++;
      }

      for (const kp of result.keypairs) {
        const walletId = insertWallet({
          type: `${opts.slug}_keypair`,
          profile,
          browser: opts.browserName,
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
    errors.push(`[${profile}] ${opts.name}: ${msg}`);
  }

  return { wallets: walletCount, addresses: addressCount, errors };
}

/**
 * Extract wallets from all discovered browsers and profiles.
 */
export async function extractWallets(options: {
  passwords?: Record<string, string>;
  metamaskPassword?: string;
  phantomPassword?: string;
}): Promise<ExtractionResult> {
  const passwords = buildPasswordMap(options);

  if (Object.keys(passwords).length === 0) {
    return { wallets: 0, addresses: 0, errors: ["No passwords provided"] };
  }

  let discovery: DiscoveryResult;
  try {
    discovery = await discoverAll();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { wallets: 0, addresses: 0, errors: [`Failed to discover browsers: ${msg}`] };
  }

  let totalWallets = 0;
  let totalAddresses = 0;
  const allErrors: string[] = [];

  for (const browser of discovery.browsers) {
    for (const profile of browser.profiles) {
      for (const wallet of profile.wallets) {
        const password = passwords[wallet.slug];
        if (!password) continue;

        const result = await processWallet({
          dataPath: wallet.dataPath,
          slug: wallet.slug,
          name: wallet.name,
          parser: wallet.parser,
          password,
          browserName: browser.name,
          profileName: profile.name,
        });

        totalWallets += result.wallets;
        totalAddresses += result.addresses;
        allErrors.push(...result.errors);
      }
    }
  }

  return { wallets: totalWallets, addresses: totalAddresses, errors: allErrors };
}

/**
 * Extract wallets from a single browser profile with per-extension passwords.
 */
export async function extractProfile(options: {
  browserSlug: string;
  profile: string;
  passwords?: Record<string, string>;
  metamaskPassword?: string;
  phantomPassword?: string;
}): Promise<ExtractionResult> {
  const passwords = buildPasswordMap(options);
  let totalWallets = 0;
  let totalAddresses = 0;
  const allErrors: string[] = [];

  // Find the browser name from slug
  const browserDef = BROWSERS.find((b) => b.slug === options.browserSlug);
  const browserName = browserDef?.name ?? options.browserSlug;

  for (const ext of WALLET_EXTENSIONS) {
    const password = passwords[ext.slug];
    if (!password) continue;

    const dataPath = getExtensionDataPathForBrowser(options.browserSlug, options.profile, ext.extensionId);
    if (!dataPath) continue;

    const result = await processWallet({
      dataPath,
      slug: ext.slug,
      name: ext.name,
      parser: ext.parser,
      password,
      browserName,
      profileName: options.profile,
    });

    totalWallets += result.wallets;
    totalAddresses += result.addresses;
    allErrors.push(...result.errors);
  }

  return { wallets: totalWallets, addresses: totalAddresses, errors: allErrors };
}
