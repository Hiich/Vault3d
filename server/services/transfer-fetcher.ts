import { getDb, insertTransfer, upsertScanState, getScanState } from "../db.ts";
import { CHAINS } from "../../src/balances.ts";

// --- Types ---

interface AlchemyTransfer {
  from: string;
  to: string;
  asset: string | null;
  category: string;
  hash: string;
  blockNum: string;
  value: number | null;
  rawContract?: { address?: string };
}

interface AlchemyResponse {
  result?: {
    transfers: AlchemyTransfer[];
    pageKey?: string;
  };
  error?: { message: string };
}

interface HeliusTransaction {
  signature: string;
  timestamp: number;
  nativeTransfers?: Array<{
    fromUserAccount: string;
    toUserAccount: string;
    amount: number;
  }>;
  tokenTransfers?: Array<{
    fromUserAccount: string;
    toUserAccount: string;
    tokenAmount: number;
    mint: string;
  }>;
}

export interface ScanProgress {
  addressesScanned: number;
  addressesTotal: number;
  transfersFound: number;
  currentAddress: string;
  currentChain: string;
  errors: string[];
}

// --- Live scan state ---

export interface LiveScanState {
  scanning: boolean;
  progress: ScanProgress | null;
  result: {
    transfersFound: number;
    connectionsFound: number;
    clustersFound: number;
    errors: string[];
  } | null;
}

export const liveScan: LiveScanState = {
  scanning: false,
  progress: null,
  result: null,
};

// --- Helpers ---

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeAddress(addr: string): string {
  if (addr.startsWith("0x")) return addr.toLowerCase();
  return addr;
}

function getAlchemyUrl(chain: string): string | null {
  const chainConfig = CHAINS.find((c) => c.name === chain && c.type === "evm");
  if (!chainConfig) return null;
  if (chain === "abstract") return null;
  return chainConfig.rpcUrl;
}

function getHeliusApiKey(): string | null {
  const solChain = CHAINS.find((c) => c.type === "solana");
  if (!solChain) return null;
  const match = solChain.rpcUrl.match(/api-key=([^&]+)/);
  return match?.[1] ?? null;
}

// --- Alchemy Asset Transfers ---

async function fetchAlchemyTransfers(
  rpcUrl: string,
  address: string,
  direction: "from" | "to",
  fromBlock: number
): Promise<{ transfers: AlchemyTransfer[]; maxBlock: number }> {
  const allTransfers: AlchemyTransfer[] = [];
  let pageKey: string | undefined;
  let maxBlock = fromBlock;
  let retries = 0;

  do {
    const params: Record<string, unknown> = {
      category: ["external", "erc20"],
      maxCount: "0x3e8",
      withMetadata: false,
      order: "asc",
    };

    if (direction === "from") {
      params.fromAddress = address;
    } else {
      params.toAddress = address;
    }

    if (fromBlock > 0) {
      params.fromBlock = `0x${fromBlock.toString(16)}`;
    }

    if (pageKey) {
      params.pageKey = pageKey;
    }

    try {
      const res = await fetch(rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "alchemy_getAssetTransfers",
          params: [params],
        }),
        signal: AbortSignal.timeout(15_000),
      });

      if (res.status === 429) {
        retries++;
        if (retries > 3) break;
        await sleep(1000 * Math.pow(2, retries));
        continue;
      }

      if (!res.ok) {
        throw new Error(`Alchemy ${res.status}: ${await res.text()}`);
      }

      const data = (await res.json()) as AlchemyResponse;
      if (data.error) {
        throw new Error(`Alchemy error: ${data.error.message}`);
      }

      const transfers = data.result?.transfers ?? [];
      allTransfers.push(...transfers);

      for (const t of transfers) {
        const blockNum = parseInt(t.blockNum, 16);
        if (blockNum > maxBlock) maxBlock = blockNum;
      }

      pageKey = data.result?.pageKey;
      retries = 0;
      await sleep(150);
    } catch (err) {
      retries++;
      if (retries > 3) throw err;
      await sleep(1000 * Math.pow(2, retries));
    }
  } while (pageKey);

  return { transfers: allTransfers, maxBlock };
}

// --- Helius Enhanced Transactions ---

async function fetchHeliusTransactions(
  address: string,
  apiKey: string
): Promise<HeliusTransaction[]> {
  const allTxs: HeliusTransaction[] = [];
  let before: string | undefined;
  let retries = 0;

  do {
    const url = new URL(`https://api.helius.xyz/v0/addresses/${address}/transactions`);
    url.searchParams.set("api-key", apiKey);
    if (before) url.searchParams.set("before", before);

    try {
      const res = await fetch(url.toString(), {
        signal: AbortSignal.timeout(15_000),
      });

      if (res.status === 429) {
        retries++;
        if (retries > 3) break;
        await sleep(1000 * Math.pow(2, retries));
        continue;
      }

      if (!res.ok) {
        throw new Error(`Helius ${res.status}: ${await res.text()}`);
      }

      const txs = (await res.json()) as HeliusTransaction[];
      if (txs.length === 0) break;

      allTxs.push(...txs);
      before = txs[txs.length - 1]?.signature;
      retries = 0;
      await sleep(200);
    } catch (err) {
      retries++;
      if (retries > 3) throw err;
      await sleep(1000 * Math.pow(2, retries));
    }
  } while (true);

  return allTxs;
}

// --- Orchestrator ---

export async function scanTransferHistory(): Promise<ScanProgress> {
  const db = getDb();

  const addresses = db
    .prepare(`SELECT a.id, a.address, a.chain_type FROM addresses a`)
    .all() as Array<{ id: number; address: string; chain_type: string }>;

  const evmAddresses = addresses.filter((a) => a.chain_type === "evm");
  const solanaAddresses = addresses.filter((a) => a.chain_type === "solana");

  // Count total work: EVM addresses * 3 chains + Solana addresses
  const evmChains = ["ethereum", "base", "polygon"];
  const totalWork = evmAddresses.length * evmChains.length + solanaAddresses.length;

  const progress: ScanProgress = {
    addressesScanned: 0,
    addressesTotal: totalWork,
    transfersFound: 0,
    currentAddress: "",
    currentChain: "",
    errors: [],
  };

  // Update live state
  liveScan.progress = progress;

  // --- EVM: Alchemy per chain ---
  for (const chain of evmChains) {
    const rpcUrl = getAlchemyUrl(chain);
    if (!rpcUrl) {
      progress.addressesScanned += evmAddresses.length;
      continue;
    }

    for (const addr of evmAddresses) {
      progress.currentAddress = addr.address;
      progress.currentChain = chain;

      try {
        const scanState = getScanState(addr.id, chain);
        const fromBlock = scanState?.last_block ?? 0;

        let maxBlock = fromBlock;

        for (const direction of ["from", "to"] as const) {
          const result = await fetchAlchemyTransfers(
            rpcUrl,
            addr.address,
            direction,
            fromBlock
          );

          for (const t of result.transfers) {
            if (!t.from || !t.to || !t.hash) continue;

            const token = t.asset ?? (t.category === "external" ? "ETH" : "UNKNOWN");
            insertTransfer({
              from_address: normalizeAddress(t.from),
              to_address: normalizeAddress(t.to),
              chain,
              token,
              amount: String(t.value ?? 0),
              tx_hash: t.hash,
              block_number: parseInt(t.blockNum, 16),
            });
            progress.transfersFound++;
          }

          if (result.maxBlock > maxBlock) maxBlock = result.maxBlock;
        }

        upsertScanState({ address_id: addr.id, chain, last_block: maxBlock });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        progress.errors.push(`EVM ${chain} ${addr.address.slice(0, 8)}...: ${msg}`);
      }

      progress.addressesScanned++;
    }
  }

  // --- Solana: Helius ---
  const heliusKey = getHeliusApiKey();
  if (heliusKey && solanaAddresses.length > 0) {
    for (const addr of solanaAddresses) {
      progress.currentAddress = addr.address;
      progress.currentChain = "solana";

      try {
        const txs = await fetchHeliusTransactions(addr.address, heliusKey);

        for (const tx of txs) {
          for (const nt of tx.nativeTransfers ?? []) {
            if (!nt.fromUserAccount || !nt.toUserAccount) continue;
            insertTransfer({
              from_address: nt.fromUserAccount,
              to_address: nt.toUserAccount,
              chain: "solana",
              token: "SOL",
              amount: String(nt.amount / 1e9),
              tx_hash: tx.signature,
              timestamp: new Date(tx.timestamp * 1000).toISOString(),
            });
            progress.transfersFound++;
          }

          for (const tt of tx.tokenTransfers ?? []) {
            if (!tt.fromUserAccount || !tt.toUserAccount) continue;
            const tokenName = tt.mint === "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" ? "USDC" : tt.mint;
            insertTransfer({
              from_address: tt.fromUserAccount,
              to_address: tt.toUserAccount,
              chain: "solana",
              token: tokenName,
              amount: String(tt.tokenAmount),
              tx_hash: tx.signature,
              timestamp: new Date(tx.timestamp * 1000).toISOString(),
            });
            progress.transfersFound++;
          }
        }

        upsertScanState({ address_id: addr.id, chain: "solana", last_block: 0 });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        progress.errors.push(`Solana ${addr.address.slice(0, 8)}...: ${msg}`);
      }

      progress.addressesScanned++;
    }
  }

  progress.currentAddress = "";
  progress.currentChain = "";
  return progress;
}
