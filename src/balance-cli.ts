import type { ExtractionOutput } from "./types";
import {
  fetchAllBalances,
  writeBalanceReport,
  printNonZeroBalances,
} from "./balances";

async function main() {
  const inputPath = process.argv[2];
  if (!inputPath) {
    console.error("Usage: bun src/balance-cli.ts <wallets_*.json>");
    process.exit(1);
  }

  console.log(`Reading extraction data from ${inputPath}...`);
  const file = Bun.file(inputPath);
  if (!(await file.exists())) {
    console.error(`File not found: ${inputPath}`);
    process.exit(1);
  }

  const output: ExtractionOutput = await file.json();

  const report = await fetchAllBalances(output);
  const { jsonPath, csvPath } = await writeBalanceReport(report);

  console.log(`\nBalances written to:`);
  console.log(`  JSON: ${jsonPath}`);
  console.log(`  CSV:  ${csvPath}`);

  printNonZeroBalances(report);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
