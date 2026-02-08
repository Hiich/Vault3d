import { CHAINS } from "../../src/balances.ts";
import { getCustomTokens } from "../db.ts";
import type { ChainConfig } from "../../src/types.ts";

/**
 * Returns CHAINS with custom tokens from DB appended to each chain's tokens[].
 * Deduplicates by contract address (lowercase for EVM).
 */
export function getEffectiveChains(): ChainConfig[] {
  const customTokens = getCustomTokens();

  return CHAINS.map((chain) => {
    const customs = customTokens.filter((t) => t.chain === chain.name);
    if (customs.length === 0) return chain;

    // Deep clone to avoid mutating the original
    const cloned: ChainConfig = {
      ...chain,
      tokens: [...chain.tokens],
    };

    const existingContracts = new Set(
      cloned.tokens.map((t) =>
        chain.type === "evm" ? t.contract.toLowerCase() : t.contract
      )
    );

    for (const ct of customs) {
      const key = chain.type === "evm" ? ct.contract.toLowerCase() : ct.contract;
      if (!existingContracts.has(key)) {
        cloned.tokens.push({
          name: ct.name,
          contract: ct.contract,
          decimals: ct.decimals,
        });
        existingContracts.add(key);
      }
    }

    return cloned;
  });
}

/**
 * Returns a map of chain name -> all token names (native + ERC-20/SPL).
 * Used by the frontend for dynamic dropdowns and columns.
 */
export function getTokenMap(): Record<string, string[]> {
  const chains = getEffectiveChains();
  const map: Record<string, string[]> = {};

  for (const chain of chains) {
    const tokens = [chain.nativeToken, ...chain.tokens.map((t) => t.name)];
    map[chain.name] = tokens;
  }

  return map;
}
