import path from "path";
import fs from "fs-extra";
import { encodeFunctionData, decodeFunctionResult } from "viem";
import type {
  ExtractionOutput,
  ChainConfig,
  AddressBalance,
  BalanceReport,
} from "./types";

// --- Chain configs ---
// RPC URLs are resolved lazily via getters so that API keys saved at runtime
// (e.g. via the Setup wizard) take effect without a server restart.

function alchemyUrl(network: string): string {
  return `https://${network}.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY ?? ""}`;
}

function heliusRpcUrl(): string {
  return `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY ?? ""}`;
}

export const CHAINS: ChainConfig[] = [
  {
    name: "ethereum",
    get rpcUrl() { return alchemyUrl("eth-mainnet"); },
    nativeToken: "ETH",
    type: "evm",
    decimals: 18,
    tokens: [
      {
        name: "USDC",
        contract: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
        decimals: 6,
      },
      {
        name: "USDT",
        contract: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
        decimals: 6,
      },
    ],
  },
  {
    name: "base",
    get rpcUrl() { return alchemyUrl("base-mainnet"); },
    nativeToken: "ETH",
    type: "evm",
    decimals: 18,
    tokens: [
      {
        name: "USDC",
        contract: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        decimals: 6,
      },
      {
        name: "USDT",
        contract: "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2",
        decimals: 6,
      },
    ],
  },
  {
    name: "polygon",
    get rpcUrl() { return alchemyUrl("polygon-mainnet"); },
    nativeToken: "POL",
    type: "evm",
    decimals: 18,
    tokens: [
      {
        name: "USDC",
        contract: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
        decimals: 6,
      },
      {
        name: "USDT",
        contract: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F",
        decimals: 6,
      },
    ],
  },
  {
    name: "abstract",
    rpcUrl: "https://api.mainnet.abs.xyz",
    nativeToken: "ETH",
    type: "evm",
    decimals: 18,
    tokens: [
      {
        name: "USDC.e",
        contract: "0x84a71ccd554cc1b02749b35d22f684cc8ec987e1",
        decimals: 6,
      },
      {
        name: "USDT",
        contract: "0x0709f39376deee2a2dfc94a58edeb2eb9df012bd",
        decimals: 6,
      },
    ],
  },
  {
    name: "solana",
    get rpcUrl() { return heliusRpcUrl(); },
    nativeToken: "SOL",
    type: "solana",
    decimals: 9,
    tokens: [
      {
        name: "USDC",
        contract: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        decimals: 6,
      },
    ],
  },
];

const FETCH_TIMEOUT = 10_000;
const CHAIN_DELAY = 200;

// --- Helpers ---

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatBalance(rawHex: string, decimals: number): string {
  const raw = BigInt(rawHex);
  if (raw === 0n) return "0.00";

  const divisor = 10n ** BigInt(decimals);
  const whole = raw / divisor;
  const remainder = raw % divisor;

  const fracStr = remainder.toString().padStart(decimals, "0");
  // Trim trailing zeros but keep at least 2 decimal places
  const trimmed = fracStr.replace(/0+$/, "").padEnd(2, "0");
  return `${whole}.${trimmed}`;
}

// --- Multicall3 ---
// Deployed at the same address on all EVM chains
const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11" as const;

const multicall3Abi = [
  {
    name: "aggregate3",
    type: "function",
    stateMutability: "payable",
    inputs: [
      {
        name: "calls",
        type: "tuple[]",
        components: [
          { name: "target", type: "address" },
          { name: "allowFailure", type: "bool" },
          { name: "callData", type: "bytes" },
        ],
      },
    ],
    outputs: [
      {
        name: "returnData",
        type: "tuple[]",
        components: [
          { name: "success", type: "bool" },
          { name: "returnData", type: "bytes" },
        ],
      },
    ],
  },
  {
    name: "getEthBalance",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "addr", type: "address" }],
    outputs: [{ name: "balance", type: "uint256" }],
  },
] as const;

const erc20BalanceOfAbi = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

// --- Address collection ---

export function collectAddresses(output: ExtractionOutput): {
  evm: string[];
  solana: string[];
} {
  const evmSet = new Set<string>();
  const solanaSet = new Set<string>();

  // MetaMask — EVM addresses
  for (const profile of Object.values(output.metamask)) {
    for (const hd of profile.hdWallets) {
      for (const addr of hd.addresses) {
        evmSet.add(addr);
      }
    }
    for (const imported of profile.importedKeys) {
      evmSet.add(imported.address);
    }
  }

  // Phantom — Solana addresses
  for (const profile of Object.values(output.phantom)) {
    for (const kp of profile.keypairs) {
      solanaSet.add(kp.publicKey);
    }
  }

  return {
    evm: [...evmSet],
    solana: [...solanaSet],
  };
}

// --- EVM Multicall ---

interface MulticallQuery {
  address: string;
  token: string;
  decimals: number;
}

/**
 * Fetch all balances (native + ERC-20) for all addresses on a chain
 * in a single Multicall3 aggregate3 call.
 */
export async function fetchEvmBalancesMulticall(
  chain: ChainConfig,
  addresses: string[]
): Promise<AddressBalance[]> {
  // Build the call list: native balance per address + token balance per address per token
  const queries: MulticallQuery[] = [];
  const calls: Array<{
    target: `0x${string}`;
    allowFailure: boolean;
    callData: `0x${string}`;
  }> = [];

  for (const addr of addresses) {
    // Native balance via Multicall3.getEthBalance(addr)
    queries.push({
      address: addr,
      token: chain.nativeToken,
      decimals: chain.decimals,
    });
    calls.push({
      target: MULTICALL3,
      allowFailure: true,
      callData: encodeFunctionData({
        abi: multicall3Abi,
        functionName: "getEthBalance",
        args: [addr as `0x${string}`],
      }),
    });

    // ERC-20 balances via token.balanceOf(addr)
    for (const token of chain.tokens) {
      queries.push({
        address: addr,
        token: token.name,
        decimals: token.decimals,
      });
      calls.push({
        target: token.contract as `0x${string}`,
        allowFailure: true,
        callData: encodeFunctionData({
          abi: erc20BalanceOfAbi,
          functionName: "balanceOf",
          args: [addr as `0x${string}`],
        }),
      });
    }
  }

  // Encode the aggregate3 call
  const data = encodeFunctionData({
    abi: multicall3Abi,
    functionName: "aggregate3",
    args: [calls],
  });

  const res = await fetch(chain.rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_call",
      params: [{ to: MULTICALL3, data }, "latest"],
    }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT),
  });

  if (!res.ok) {
    throw new Error(`RPC error ${res.status}: ${await res.text()}`);
  }

  const rpcResult = (await res.json()) as {
    result?: `0x${string}`;
    error?: { message: string };
  };

  if (rpcResult.error || !rpcResult.result) {
    throw new Error(
      `RPC error: ${rpcResult.error?.message ?? "no result"}`
    );
  }

  // Decode aggregate3 return: tuple(bool success, bytes returnData)[]
  const decoded = decodeFunctionResult({
    abi: multicall3Abi,
    functionName: "aggregate3",
    data: rpcResult.result,
  }) as Array<{ success: boolean; returnData: `0x${string}` }>;

  const balances: AddressBalance[] = [];
  for (let i = 0; i < queries.length; i++) {
    const query = queries[i]!;
    const result = decoded[i]!;

    let rawHex = "0x0";
    if (result.success && result.returnData.length > 2) {
      rawHex = result.returnData;
    }

    balances.push({
      address: query.address,
      chain: chain.name,
      token: query.token,
      balance: formatBalance(rawHex, query.decimals),
      balanceRaw: rawHex,
      type: "evm",
    });
  }

  return balances;
}

// --- Solana RPC (batch) ---

interface SolanaQuery {
  address: string;
  token: string;
  decimals: number;
}

/**
 * Fetch all Solana balances (native SOL + SPL tokens) for all addresses
 * using JSON-RPC batch requests.
 */
export async function fetchSolanaBalancesBatch(
  chain: ChainConfig,
  addresses: string[]
): Promise<AddressBalance[]> {
  const queries: SolanaQuery[] = [];
  const batch: Array<{ jsonrpc: string; id: number; method: string; params: unknown[] }> = [];
  let id = 1;

  for (const pubkey of addresses) {
    // Native SOL balance
    queries.push({ address: pubkey, token: chain.nativeToken, decimals: chain.decimals });
    batch.push({
      jsonrpc: "2.0",
      id: id++,
      method: "getBalance",
      params: [pubkey],
    });

    // SPL token balances
    for (const token of chain.tokens) {
      queries.push({ address: pubkey, token: token.name, decimals: token.decimals });
      batch.push({
        jsonrpc: "2.0",
        id: id++,
        method: "getTokenAccountsByOwner",
        params: [pubkey, { mint: token.contract }, { encoding: "jsonParsed" }],
      });
    }
  }

  const res = await fetch(chain.rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(batch),
    signal: AbortSignal.timeout(FETCH_TIMEOUT),
  });

  if (!res.ok) {
    throw new Error(`Solana RPC error ${res.status}: ${await res.text()}`);
  }

  const results = (await res.json()) as Array<{
    id: number;
    result?: unknown;
    error?: { message: string };
  }>;

  // Sort by id to match query order
  results.sort((a, b) => a.id - b.id);

  const balances: AddressBalance[] = [];
  for (let i = 0; i < queries.length; i++) {
    const query = queries[i]!;
    const result = results[i]!;

    let rawHex = "0x0";

    if (result.error) {
      // Skip failed queries, report as zero
    } else if (query.token === chain.nativeToken) {
      // getBalance result: { value: number }
      const val = (result.result as { value: number })?.value ?? 0;
      rawHex = `0x${val.toString(16)}`;
    } else {
      // getTokenAccountsByOwner result
      const tokenResult = result.result as {
        value: Array<{
          account: {
            data: {
              parsed: {
                info: { tokenAmount: { amount: string } };
              };
            };
          };
        }>;
      } | undefined;
      const accounts = tokenResult?.value ?? [];
      let total = 0n;
      for (const acc of accounts) {
        total += BigInt(acc.account.data.parsed.info.tokenAmount.amount);
      }
      rawHex = `0x${total.toString(16)}`;
    }

    balances.push({
      address: query.address,
      chain: chain.name,
      token: query.token,
      balance: formatBalance(rawHex, query.decimals),
      balanceRaw: rawHex,
      type: "solana",
    });
  }

  return balances;
}

// --- Orchestrator ---

export async function fetchAllBalances(
  output: ExtractionOutput
): Promise<BalanceReport> {
  const { evm, solana } = collectAddresses(output);
  const balances: AddressBalance[] = [];

  console.log(
    `\nFetching balances for ${evm.length} EVM + ${solana.length} Solana addresses...\n`
  );

  // EVM chains — one Multicall3 aggregate3 per chain
  for (const chain of CHAINS.filter((c) => c.type === "evm")) {
    if (evm.length === 0) continue;

    console.log(`  [${chain.name}] querying ${evm.length} addresses via multicall...`);

    try {
      const chainBalances = await fetchEvmBalancesMulticall(chain, evm);
      balances.push(...chainBalances);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`  [${chain.name}] FAILED: ${msg}`);
    }

    await sleep(CHAIN_DELAY);
  }

  // Solana — single batch request for all addresses
  const solChain = CHAINS.find((c) => c.type === "solana")!;
  if (solana.length > 0) {
    console.log(
      `  [${solChain.name}] querying ${solana.length} addresses via batch...`
    );

    try {
      const solBalances = await fetchSolanaBalancesBatch(solChain, solana);
      balances.push(...solBalances);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`  [${solChain.name}] FAILED: ${msg}`);
    }
  }

  return {
    fetchedAt: new Date().toISOString(),
    balances,
  };
}

// --- Output ---

export async function writeBalanceReport(report: BalanceReport): Promise<{
  jsonPath: string;
  csvPath: string;
}> {
  await fs.ensureDir("output");
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const jsonPath = path.join("output", `balances_${timestamp}.json`);
  const csvPath = path.join("output", `balances_${timestamp}.csv`);

  // JSON
  await Bun.write(jsonPath, JSON.stringify(report, null, 2));
  await fs.chmod(jsonPath, 0o600);

  // CSV
  const header = "address,chain,token,balance,type";
  const rows = report.balances.map(
    (b) => `${b.address},${b.chain},${b.token},${b.balance},${b.type}`
  );
  await Bun.write(csvPath, [header, ...rows].join("\n") + "\n");
  await fs.chmod(csvPath, 0o600);

  return { jsonPath, csvPath };
}

export function printNonZeroBalances(report: BalanceReport): void {
  const nonZero = report.balances.filter(
    (b) => b.balance !== "0.00" && b.balance !== "0.00"
  );

  if (nonZero.length === 0) {
    console.log("\nNo non-zero balances found.");
    return;
  }

  console.log(`\nNon-zero balances (${nonZero.length}):`);
  for (const b of nonZero) {
    const addrShort =
      b.type === "evm"
        ? `${b.address.slice(0, 6)}...${b.address.slice(-4)}`
        : `${b.address.slice(0, 6)}...${b.address.slice(-4)}`;
    console.log(
      `  ${addrShort}  ${b.chain.padEnd(10)} ${b.token.padEnd(6)} ${b.balance}`
    );
  }
}
