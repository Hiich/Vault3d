import type { MetaMaskResult } from "./metamask";
import type { PhantomResult } from "./phantom";

export interface ExtractionOutput {
  extractedAt: string;
  metamask: Record<string, MetaMaskResult>;
  phantom: Record<string, PhantomResult>;
  errors: Array<{ profile: string; wallet: string; error: string }>;
}

export interface ChainConfig {
  name: string;
  rpcUrl: string;
  nativeToken: string;
  type: "evm" | "solana";
  decimals: number;
  tokens: Array<{ name: string; contract: string; decimals: number }>;
}

export interface AddressBalance {
  address: string;
  chain: string;
  token: string;
  balance: string;
  balanceRaw: string;
  type: "evm" | "solana";
}

export interface BalanceReport {
  fetchedAt: string;
  balances: AddressBalance[];
}
