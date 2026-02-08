import {
  createWalletClient,
  createPublicClient,
  http,
  parseUnits,
  defineChain,
  encodeFunctionData,
} from "viem";
import type { Chain, Account } from "viem";
import { mainnet, base, polygon } from "viem/chains";
import { mnemonicToAccount, privateKeyToAccount } from "viem/accounts";

// --- Chain definitions ---

const abstractChain = defineChain({
  id: 2741,
  name: "Abstract",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://api.mainnet.abs.xyz"] },
  },
  blockExplorers: {
    default: { name: "Abstract Explorer", url: "https://explorer.abs.xyz" },
  },
});

const CHAIN_MAP: Record<string, Chain> = {
  ethereum: mainnet,
  base: base,
  polygon: polygon,
  abstract: abstractChain,
};

const ALCHEMY_API_KEY = process.env.ALCHEMY_API_KEY ?? "";

const RPC_URLS: Record<string, string> = {
  ethereum: `https://eth-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`,
  base: `https://base-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`,
  polygon: `https://polygon-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`,
  abstract: "https://api.mainnet.abs.xyz",
};

// --- Token contracts ---

interface TokenInfo {
  contract: `0x${string}`;
  decimals: number;
}

const TOKEN_CONTRACTS: Record<string, Record<string, TokenInfo>> = {
  ethereum: {
    USDC: { contract: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", decimals: 6 },
    USDT: { contract: "0xdAC17F958D2ee523a2206206994597C13D831ec7", decimals: 6 },
  },
  base: {
    USDC: { contract: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6 },
    USDT: { contract: "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2", decimals: 6 },
  },
  polygon: {
    USDC: { contract: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", decimals: 6 },
    USDT: { contract: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F", decimals: 6 },
  },
  abstract: {
    "USDC.e": { contract: "0x84a71ccd554cc1b02749b35d22f684cc8ec987e1", decimals: 6 },
    USDT: { contract: "0x0709f39376deee2a2dfc94a58edeb2eb9df012bd", decimals: 6 },
  },
};

// Native token decimals per chain
const NATIVE_DECIMALS: Record<string, number> = {
  ethereum: 18,
  base: 18,
  polygon: 18,
  abstract: 18,
};

import { getEffectiveChains } from "./token-registry.ts";

function resolveTokenInfo(
  chainName: string,
  tokenName: string
): TokenInfo | null {
  // Check hardcoded first for speed
  const hardcoded = TOKEN_CONTRACTS[chainName]?.[tokenName];
  if (hardcoded) return hardcoded;

  // Fall back to dynamic tokens from DB
  const chains = getEffectiveChains();
  const chain = chains.find((c) => c.name === chainName);
  if (!chain) return null;

  const token = chain.tokens.find((t) => t.name === tokenName);
  if (!token) return null;

  return { contract: token.contract as `0x${string}`, decimals: token.decimals };
}

// ERC-20 transfer ABI
const erc20TransferAbi = [
  {
    name: "transfer",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

// --- Account reconstruction ---

export interface WalletRow {
  id: number;
  type: string;
  mnemonic: string | null;
  private_key: string | null;
}

export interface AddressRow {
  id: number;
  wallet_id: number;
  address: string;
  chain_type: string;
  derivation_index: number | null;
}

/**
 * Reconstruct a viem Account from a DB wallet + address row.
 */
export function getAccount(wallet: WalletRow, address: AddressRow): Account {
  if (wallet.type.endsWith("_hd") && wallet.mnemonic) {
    return mnemonicToAccount(wallet.mnemonic, {
      addressIndex: address.derivation_index ?? 0,
    });
  }

  if (wallet.type.endsWith("_imported") && wallet.private_key) {
    const key = wallet.private_key.startsWith("0x")
      ? (wallet.private_key as `0x${string}`)
      : (`0x${wallet.private_key}` as `0x${string}`);
    return privateKeyToAccount(key);
  }

  throw new Error(`Unsupported wallet type for EVM transactions: ${wallet.type}`);
}

// --- Transaction parameters ---

export interface EvmTxParams {
  wallet: WalletRow;
  address: AddressRow;
  chain: string;
  token: string; // "native", "USDC", "USDT", "USDC.e"
  toAddress: string;
  amount: string; // human-readable amount (e.g. "1.5")
}

function getChainAndRpc(chainName: string): { chain: Chain; rpcUrl: string } {
  const chain = CHAIN_MAP[chainName];
  const rpcUrl = RPC_URLS[chainName];
  if (!chain || !rpcUrl) {
    throw new Error(`Unsupported EVM chain: ${chainName}`);
  }
  return { chain, rpcUrl };
}

function isNativeToken(token: string): boolean {
  return token === "native" || token === "ETH" || token === "POL";
}

/**
 * Estimate gas cost for an EVM transaction.
 */
export async function estimateEvmTx(params: EvmTxParams): Promise<{
  estimatedGas: string;
  gasPrice: string;
  totalCostWei: string;
}> {
  const { chain, rpcUrl } = getChainAndRpc(params.chain);
  const account = getAccount(params.wallet, params.address);

  const publicClient = createPublicClient({
    chain,
    transport: http(rpcUrl),
  });

  if (isNativeToken(params.token)) {
    const decimals = NATIVE_DECIMALS[params.chain] ?? 18;
    const value = parseUnits(params.amount, decimals);

    const [gasEstimate, gasPrice] = await Promise.all([
      publicClient.estimateGas({
        account,
        to: params.toAddress as `0x${string}`,
        value,
      }),
      publicClient.getGasPrice(),
    ]);

    const totalCost = gasEstimate * gasPrice;

    return {
      estimatedGas: gasEstimate.toString(),
      gasPrice: gasPrice.toString(),
      totalCostWei: totalCost.toString(),
    };
  }

  // ERC-20 transfer
  const tokenInfo = resolveTokenInfo(params.chain, params.token);
  if (!tokenInfo) {
    throw new Error(`Unknown token ${params.token} on chain ${params.chain}`);
  }

  const value = parseUnits(params.amount, tokenInfo.decimals);
  const data = encodeFunctionData({
    abi: erc20TransferAbi,
    functionName: "transfer",
    args: [params.toAddress as `0x${string}`, value],
  });

  const [gasEstimate, gasPrice] = await Promise.all([
    publicClient.estimateGas({
      account,
      to: tokenInfo.contract,
      data,
    }),
    publicClient.getGasPrice(),
  ]);

  const totalCost = gasEstimate * gasPrice;

  return {
    estimatedGas: gasEstimate.toString(),
    gasPrice: gasPrice.toString(),
    totalCostWei: totalCost.toString(),
  };
}

/**
 * Sign and broadcast an EVM transaction.
 * Returns the transaction hash.
 */
export async function sendEvmTx(params: EvmTxParams): Promise<{
  txHash: string;
  amountRaw: string;
}> {
  const { chain, rpcUrl } = getChainAndRpc(params.chain);
  const account = getAccount(params.wallet, params.address);

  const walletClient = createWalletClient({
    account,
    chain,
    transport: http(rpcUrl),
  });

  if (isNativeToken(params.token)) {
    const decimals = NATIVE_DECIMALS[params.chain] ?? 18;
    const value = parseUnits(params.amount, decimals);

    const txHash = await walletClient.sendTransaction({
      to: params.toAddress as `0x${string}`,
      value,
    });

    return { txHash, amountRaw: value.toString() };
  }

  // ERC-20 transfer
  const tokenInfo = resolveTokenInfo(params.chain, params.token);
  if (!tokenInfo) {
    throw new Error(`Unknown token ${params.token} on chain ${params.chain}`);
  }

  const value = parseUnits(params.amount, tokenInfo.decimals);

  const txHash = await walletClient.writeContract({
    address: tokenInfo.contract,
    abi: erc20TransferAbi,
    functionName: "transfer",
    args: [params.toAddress as `0x${string}`, value],
  });

  return { txHash, amountRaw: value.toString() };
}
