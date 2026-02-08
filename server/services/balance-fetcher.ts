import { getDb, upsertBalance } from "../db.ts";
import { fetchEvmBalancesMulticall, fetchSolanaBalancesBatch } from "../../src/balances.ts";
import { getEffectiveChains } from "./token-registry.ts";

interface DbAddress {
  id: number;
  address: string;
  chain_type: string;
}

/**
 * Fetch balances for addresses stored in the DB and upsert them.
 *
 * 1. Query all addresses from DB (optionally filtered by addressIds)
 * 2. Group addresses by chain_type (evm vs solana)
 * 3. For each EVM chain in CHAINS, call fetchEvmBalancesMulticall
 * 4. For Solana chain, call fetchSolanaBalancesBatch
 * 5. Upsert all results into balances table
 * 6. Return count of updated balances
 */
export async function fetchAndStoreBalances(addressIds?: number[]): Promise<{
  updated: number;
  errors: string[];
}> {
  const db = getDb();
  let dbAddresses: DbAddress[];

  if (addressIds && addressIds.length > 0) {
    const placeholders = addressIds.map(() => "?").join(", ");
    dbAddresses = db
      .prepare(`SELECT id, address, chain_type FROM addresses WHERE id IN (${placeholders})`)
      .all(...addressIds) as DbAddress[];
  } else {
    dbAddresses = db
      .prepare("SELECT id, address, chain_type FROM addresses")
      .all() as DbAddress[];
  }

  if (dbAddresses.length === 0) {
    return { updated: 0, errors: [] };
  }

  // Group by chain_type
  const evmAddresses: DbAddress[] = [];
  const solanaAddresses: DbAddress[] = [];

  for (const addr of dbAddresses) {
    if (addr.chain_type === "evm") {
      evmAddresses.push(addr);
    } else if (addr.chain_type === "solana") {
      solanaAddresses.push(addr);
    }
  }

  // Build lookup: address string -> DB address row(s)
  const evmLookup = new Map<string, DbAddress[]>();
  for (const a of evmAddresses) {
    const key = a.address.toLowerCase();
    const existing = evmLookup.get(key) ?? [];
    existing.push(a);
    evmLookup.set(key, existing);
  }

  const solanaLookup = new Map<string, DbAddress[]>();
  for (const a of solanaAddresses) {
    const existing = solanaLookup.get(a.address) ?? [];
    existing.push(a);
    solanaLookup.set(a.address, existing);
  }

  let updated = 0;
  const errors: string[] = [];

  // Fetch EVM balances per chain
  const effectiveChains = getEffectiveChains();
  const evmChains = effectiveChains.filter((c) => c.type === "evm");
  const evmAddressStrings = evmAddresses.map((a) => a.address);

  for (const chain of evmChains) {
    if (evmAddressStrings.length === 0) continue;

    try {
      const balances = await fetchEvmBalancesMulticall(chain, evmAddressStrings);

      for (const b of balances) {
        const dbRows = evmLookup.get(b.address.toLowerCase());
        if (!dbRows) continue;

        for (const dbRow of dbRows) {
          upsertBalance({
            address_id: dbRow.id,
            chain: b.chain,
            token: b.token,
            balance: b.balance,
            balance_raw: b.balanceRaw,
          });
          updated++;
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`[${chain.name}] ${msg}`);
    }
  }

  // Fetch Solana balances
  const solChain = effectiveChains.find((c) => c.type === "solana");
  const solanaAddressStrings = solanaAddresses.map((a) => a.address);

  if (solChain && solanaAddressStrings.length > 0) {
    try {
      const balances = await fetchSolanaBalancesBatch(solChain, solanaAddressStrings);

      for (const b of balances) {
        const dbRows = solanaLookup.get(b.address);
        if (!dbRows) continue;

        for (const dbRow of dbRows) {
          upsertBalance({
            address_id: dbRow.id,
            chain: b.chain,
            token: b.token,
            balance: b.balance,
            balance_raw: b.balanceRaw,
          });
          updated++;
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`[solana] ${msg}`);
    }
  }

  return { updated, errors };
}
