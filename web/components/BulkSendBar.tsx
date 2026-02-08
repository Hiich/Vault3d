import { useState } from "react";
import { bulkSend } from "../lib/api.ts";
import type { BulkSendResult } from "../lib/api.ts";

interface Props {
  selectedRows: Array<{ addressId: number; address: string; chainType: string }>;
  tokenMap: Record<string, string[]>;
  onClearSelection: () => void;
  onComplete: () => void;
}

const defaultEvmTokens = ["ETH", "USDC", "USDT"];
const defaultSolanaTokens = ["SOL", "USDC"];

export function BulkSendBar({ selectedRows, tokenMap, onClearSelection, onComplete }: Props) {
  const chainType = selectedRows[0]?.chainType ?? "evm";

  // Derive tokens from tokenMap for the selected chain type
  const tokens = (() => {
    if (chainType === "solana") {
      return tokenMap["solana"] ?? defaultSolanaTokens;
    }
    // For EVM, collect unique tokens across all EVM chains
    const evmChains = ["ethereum", "base", "polygon", "abstract"];
    const set = new Set<string>();
    for (const c of evmChains) {
      for (const t of (tokenMap[c] ?? [])) set.add(t);
    }
    return set.size > 0 ? Array.from(set) : defaultEvmTokens;
  })();

  const [token, setToken] = useState(tokens[0] ?? "");
  const [chain, setChain] = useState(chainType === "evm" ? "ethereum" : "solana");
  const [toAddress, setToAddress] = useState("");
  const [amount, setAmount] = useState("");
  const [useMax, setUseMax] = useState(false);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<BulkSendResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const evmChains = ["ethereum", "base", "polygon", "abstract"];

  const handleSend = async () => {
    if (!toAddress.trim()) return;
    if (!useMax && !amount.trim()) return;

    setSending(true);
    setError(null);
    setResult(null);

    try {
      const transfers = selectedRows.map((row) => ({
        fromAddressId: row.addressId,
        toAddress: toAddress.trim(),
        chain: chainType === "solana" ? "solana" : chain,
        token,
        amount: useMax ? "max" : amount,
      }));

      const res = await bulkSend(transfers);
      setResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Bulk send failed");
    } finally {
      setSending(false);
    }
  };

  if (result) {
    return (
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 mb-6">
        <div className="flex items-center justify-between">
          <div className="text-sm">
            <span className="text-green-400 font-semibold">{result.summary.succeeded} succeeded</span>
            {result.summary.failed > 0 && (
              <span className="text-red-400 font-semibold ml-3">{result.summary.failed} failed</span>
            )}
            <span className="text-gray-500 ml-3">of {result.summary.total} transfers</span>
          </div>
          <div className="flex items-center gap-3">
            <a
              href="#/transactions"
              className="text-xs text-blue-400 hover:text-blue-300"
            >
              View in Transactions
            </a>
            <button
              onClick={onComplete}
              className="text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 px-3 py-1.5 rounded-lg"
            >
              Done
            </button>
          </div>
        </div>
        {result.results.some((r) => r.error) && (
          <div className="mt-3 space-y-1">
            {result.results
              .filter((r) => r.error)
              .map((r, i) => (
                <div key={i} className="text-xs text-red-400">
                  Address #{r.fromAddressId}: {r.error}
                </div>
              ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="bg-gray-900 border border-blue-800/50 rounded-xl p-4 mb-6 sticky top-0 z-10">
      <div className="flex items-center gap-3 flex-wrap">
        {/* Count */}
        <div className="text-sm text-blue-400 font-semibold whitespace-nowrap">
          {selectedRows.length} selected
        </div>

        <div className="h-5 w-px bg-gray-700" />

        {/* Chain (EVM only) */}
        {chainType === "evm" && (
          <select
            value={chain}
            onChange={(e) => setChain(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-xs text-gray-100 focus:outline-none focus:border-blue-500"
          >
            {evmChains.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        )}

        {/* Token */}
        <select
          value={token}
          onChange={(e) => {
            setToken(e.target.value);
          }}
          className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-xs text-gray-100 focus:outline-none focus:border-blue-500"
        >
          {tokens.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>

        {/* To Address */}
        <input
          type="text"
          value={toAddress}
          onChange={(e) => setToAddress(e.target.value)}
          placeholder={chainType === "solana" ? "Recipient solana address..." : "Recipient 0x address..."}
          className="flex-1 min-w-[200px] bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-xs text-gray-100 placeholder-gray-600 font-mono focus:outline-none focus:border-blue-500"
        />

        {/* Max checkbox */}
        <label className="flex items-center gap-1.5 text-xs text-gray-400 cursor-pointer whitespace-nowrap">
          <input
            type="checkbox"
            checked={useMax}
            onChange={(e) => setUseMax(e.target.checked)}
            className="rounded bg-gray-700 border-gray-600 text-blue-500 focus:ring-blue-500 focus:ring-offset-0"
          />
          Max
        </label>

        {/* Amount */}
        {!useMax && (
          <input
            type="text"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="Amount"
            className="w-24 bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-xs text-gray-100 placeholder-gray-600 font-mono focus:outline-none focus:border-blue-500"
          />
        )}

        {/* Send */}
        <button
          onClick={handleSend}
          disabled={sending || !toAddress.trim() || (!useMax && !amount.trim())}
          className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs px-4 py-1.5 rounded-lg font-semibold whitespace-nowrap"
        >
          {sending ? "Sending..." : "Send All"}
        </button>

        {/* Clear */}
        <button
          onClick={onClearSelection}
          className="text-xs text-gray-500 hover:text-gray-300 px-2 py-1.5"
        >
          Clear
        </button>
      </div>

      {error && (
        <div className="mt-3 bg-red-900/30 border border-red-800 rounded-lg p-2 text-xs text-red-400">
          {error}
        </div>
      )}
    </div>
  );
}
