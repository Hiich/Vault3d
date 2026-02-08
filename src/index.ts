import prompts from "prompts";
import path from "path";
import fs from "fs-extra";
import {
  discoverProfiles,
  getExtensionDataPath,
  EXTENSION_IDS,
} from "./config";
import { readAllEntries } from "./leveldb-reader";
import * as metamask from "./metamask";
import * as phantom from "./phantom";
import type { ExtractionOutput } from "./types";
import {
  fetchAllBalances,
  writeBalanceReport,
  printNonZeroBalances,
} from "./balances";

async function isBraveRunning(): Promise<boolean> {
  const proc = Bun.spawn(["pgrep", "-x", "Brave Browser"]);
  const code = await proc.exited;
  return code === 0;
}

async function main() {
  console.log("=== Wallet Key Extraction Tool ===\n");

  // Warn if Brave is running (LevelDB lock files)
  if (await isBraveRunning()) {
    console.log(
      "⚠  Brave Browser is running. LevelDB files may be locked."
    );
    console.log(
      "   Close Brave for reliable extraction, or we'll try copying anyway.\n"
    );
  }

  // Discover profiles
  const profiles = await discoverProfiles();
  console.log(`Found ${profiles.length} browser profiles.\n`);

  // Prompt for passwords
  const { mmPassword } = await prompts({
    type: "password",
    name: "mmPassword",
    message: "MetaMask password:",
  });
  if (!mmPassword) {
    console.log("No MetaMask password provided, skipping MetaMask.");
  }

  const { phPassword } = await prompts({
    type: "password",
    name: "phPassword",
    message: "Phantom password (leave empty to use same as MetaMask):",
  });
  const phantomPassword = phPassword || mmPassword;
  if (!phantomPassword) {
    console.log("No Phantom password provided, skipping Phantom.");
  }

  const output: ExtractionOutput = {
    extractedAt: new Date().toISOString(),
    metamask: {},
    phantom: {},
    errors: [],
  };

  for (const profile of profiles) {
    // --- MetaMask ---
    if (mmPassword) {
      const mmPath = getExtensionDataPath(profile, EXTENSION_IDS.METAMASK);
      if (await fs.pathExists(mmPath)) {
        try {
          console.log(`[MetaMask] ${profile} — reading vault...`);
          const entries = await readAllEntries(mmPath);
          const vault = metamask.findVault(entries);
          if (!vault) {
            output.errors.push({
              profile,
              wallet: "metamask",
              error: "No vault found in LevelDB",
            });
            continue;
          }
          const iterations =
            vault.keyMetadata?.params?.iterations ?? 10000;
          console.log(
            `[MetaMask] ${profile} — decrypting (${iterations} iterations)...`
          );
          const keyrings = await metamask.decryptVault(vault, mmPassword);
          output.metamask[profile] = metamask.extractKeys(keyrings);
          console.log(
            `[MetaMask] ${profile} — OK (${output.metamask[profile].hdWallets.length} HD wallets, ${output.metamask[profile].importedKeys.length} imported keys)`
          );
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          const isWrongPassword = msg.includes(
            "Unsupported state or unable to authenticate data"
          );
          if (isWrongPassword) {
            console.log(
              `[MetaMask] ${profile} — wrong password. Enter password for this profile (or press Enter to skip):`
            );
            const { retryPassword } = await prompts({
              type: "password",
              name: "retryPassword",
              message: `[MetaMask] ${profile} password:`,
            });
            if (retryPassword) {
              try {
                const entries = await readAllEntries(
                  getExtensionDataPath(profile, EXTENSION_IDS.METAMASK)
                );
                const vault = metamask.findVault(entries);
                if (vault) {
                  const keyrings = await metamask.decryptVault(
                    vault,
                    retryPassword
                  );
                  output.metamask[profile] = metamask.extractKeys(keyrings);
                  console.log(
                    `[MetaMask] ${profile} — OK (${output.metamask[profile].hdWallets.length} HD wallets, ${output.metamask[profile].importedKeys.length} imported keys)`
                  );
                  continue;
                }
              } catch (retryErr: unknown) {
                const retryMsg =
                  retryErr instanceof Error
                    ? retryErr.message
                    : String(retryErr);
                console.log(
                  `[MetaMask] ${profile} — retry FAILED: ${retryMsg}`
                );
                output.errors.push({
                  profile,
                  wallet: "metamask",
                  error: retryMsg,
                });
                continue;
              }
            }
          }
          console.log(`[MetaMask] ${profile} — FAILED: ${msg}`);
          output.errors.push({ profile, wallet: "metamask", error: msg });
        }
      }
    }

    // --- Phantom ---
    if (phantomPassword) {
      const phPath = getExtensionDataPath(profile, EXTENSION_IDS.PHANTOM);
      if (await fs.pathExists(phPath)) {
        try {
          console.log(`[Phantom] ${profile} — reading vault...`);
          const entries = await readAllEntries(phPath);
          const vaultData = phantom.findVault(entries);
          if (!vaultData) {
            output.errors.push({
              profile,
              wallet: "phantom",
              error: "No vault found in LevelDB",
            });
            continue;
          }
          console.log(
            `[Phantom] ${profile} — found: encryptionKey, ${vaultData.seeds.length} seed(s), ${vaultData.privateKeys.length} privateKey(s)`
          );
          console.log(
            `[Phantom] ${profile} — decrypting (${vaultData.encryptionKey.encryptedKey.kdf}, ${vaultData.encryptionKey.encryptedKey.iterations ?? "default"} iterations)...`
          );
          const decrypted = await phantom.decryptVault(
            vaultData,
            phantomPassword
          );
          output.phantom[profile] = phantom.extractKeys(decrypted);
          console.log(
            `[Phantom] ${profile} — OK${output.phantom[profile].mnemonic ? " (mnemonic found)" : ""}${output.phantom[profile].keypairs.length ? ` (${output.phantom[profile].keypairs.length} keypairs)` : ""}${output.phantom[profile].raw ? " (raw data — check output)" : ""}`
          );
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          const isWrongPassword = msg.includes("stage 1: master key");
          if (isWrongPassword) {
            console.log(
              `[Phantom] ${profile} — wrong password. Enter password for this profile (or press Enter to skip):`
            );
            const { retryPassword } = await prompts({
              type: "password",
              name: "retryPassword",
              message: `[Phantom] ${profile} password:`,
            });
            if (retryPassword) {
              try {
                const entries = await readAllEntries(
                  getExtensionDataPath(profile, EXTENSION_IDS.PHANTOM)
                );
                const vaultData = phantom.findVault(entries);
                if (vaultData) {
                  const decrypted = await phantom.decryptVault(
                    vaultData,
                    retryPassword
                  );
                  output.phantom[profile] = phantom.extractKeys(decrypted);
                  console.log(
                    `[Phantom] ${profile} — OK${output.phantom[profile].mnemonic ? " (mnemonic found)" : ""}${output.phantom[profile].keypairs.length ? ` (${output.phantom[profile].keypairs.length} keypairs)` : ""}${output.phantom[profile].raw ? " (raw data — check output)" : ""}`
                  );
                  continue;
                }
              } catch (retryErr: unknown) {
                const retryMsg =
                  retryErr instanceof Error
                    ? retryErr.message
                    : String(retryErr);
                console.log(
                  `[Phantom] ${profile} — retry FAILED: ${retryMsg}`
                );
                output.errors.push({
                  profile,
                  wallet: "phantom",
                  error: retryMsg,
                });
                continue;
              }
            }
          }
          console.log(`[Phantom] ${profile} — FAILED: ${msg}`);
          output.errors.push({ profile, wallet: "phantom", error: msg });
        }
      }
    }
  }

  // Write output
  await fs.ensureDir("output");
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outPath = path.join("output", `wallets_${timestamp}.json`);
  await Bun.write(outPath, JSON.stringify(output, null, 2));
  await fs.chmod(outPath, 0o600); // owner-only read/write

  console.log(`\nResults written to ${outPath}`);

  // Quick summary
  const mmCount = Object.keys(output.metamask).length;
  const phCount = Object.keys(output.phantom).length;
  const errCount = output.errors.length;
  console.log(
    `Summary: ${mmCount} MetaMask profiles, ${phCount} Phantom profiles, ${errCount} errors.`
  );

  // Balance fetching prompt
  const { fetchBalances } = await prompts({
    type: "confirm",
    name: "fetchBalances",
    message: "Fetch balances for all extracted addresses?",
    initial: true,
  });

  if (fetchBalances) {
    const report = await fetchAllBalances(output);
    const { jsonPath, csvPath } = await writeBalanceReport(report);
    console.log(`\nBalances written to:`);
    console.log(`  JSON: ${jsonPath}`);
    console.log(`  CSV:  ${csvPath}`);
    printNonZeroBalances(report);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
