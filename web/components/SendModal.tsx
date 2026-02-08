import { useState } from "react";
import { estimateTx, sendTx } from "../lib/api.ts";
import type { TxEstimate } from "../lib/api.ts";
import { truncateAddress } from "../lib/format.ts";

interface Props {
  fromAddressId: number;
  fromAddress: string;
  chainType: string;
  onClose: () => void;
  onSent: () => void;
}

const chainOptions: Record<string, string[]> = {
  evm: ["ethereum", "base", "polygon", "abstract"],
  solana: ["solana"],
};

const tokenOptions: Record<string, string[]> = {
  ethereum: ["ETH", "USDC", "USDT"],
  base: ["ETH", "USDC", "USDT"],
  polygon: ["POL", "USDC", "USDT"],
  abstract: ["ETH", "USDC.e", "USDT"],
  solana: ["SOL", "USDC"],
};

export function SendModal({ fromAddressId, fromAddress, chainType, onClose, onSent }: Props) {
  const chains = chainOptions[chainType] ?? [];
  const [chain, setChain] = useState(chains[0] ?? "");
  const [token, setToken] = useState((tokenOptions[chains[0] ?? ""] ?? [])[0] ?? "");
  const [toAddress, setToAddress] = useState("");
  const [amount, setAmount] = useState("");
  const [estimate, setEstimate] = useState<TxEstimate | null>(null);
  const [estimating, setEstimating] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [txResult, setTxResult] = useState<{ txHash: string } | null>(null);

  const tokens = tokenOptions[chain] ?? [];

  const handleChainChange = (newChain: string) => {
    setChain(newChain);
    const newTokens = tokenOptions[newChain] ?? [];
    setToken(newTokens[0] ?? "");
    setEstimate(null);
  };

  const handleEstimate = async () => {
    if (!toAddress || !amount || !chain || !token) return;
    setEstimating(true);
    setError(null);
    setEstimate(null);
    try {
      const est = await estimateTx({
        fromAddressId,
        toAddress,
        chain,
        token,
        amount,
      });
      setEstimate(est);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Estimation failed");
    } finally {
      setEstimating(false);
    }
  };

  const handleSend = async () => {
    if (!toAddress || !amount || !chain || !token) return;
    setSending(true);
    setError(null);
    try {
      const result = await sendTx({
        fromAddressId,
        toAddress,
        chain,
        token,
        amount,
      });
      setTxResult(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Transaction failed");
    } finally {
      setSending(false);
    }
  };

  const isFormValid = toAddress.trim() && amount.trim() && chain && token;

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-900 border border-gray-800 rounded-xl w-full max-w-md shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
          <h3 className="text-sm font-semibold text-gray-200">Send Tokens</h3>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-300 p-1"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-4 space-y-4">
          {/* From */}
          <div>
            <label className="block text-xs text-gray-500 mb-1">From</label>
            <div className="bg-gray-800 rounded-lg px-3 py-2 text-sm text-gray-400 font-mono">
              {truncateAddress(fromAddress, 12)}
            </div>
          </div>

          {txResult ? (
            /* Success state */
            <div className="text-center py-4">
              <div className="text-green-400 text-lg font-bold mb-2">Transaction Sent</div>
              <div className="text-xs text-gray-400 font-mono break-all mb-4">{txResult.txHash}</div>
              <button
                onClick={onSent}
                className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm"
              >
                Done
              </button>
            </div>
          ) : (
            <>
              {/* Chain */}
              <div>
                <label className="block text-xs text-gray-500 mb-1">Chain</label>
                <select
                  value={chain}
                  onChange={(e) => handleChainChange(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-blue-500"
                >
                  {chains.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>

              {/* Token */}
              <div>
                <label className="block text-xs text-gray-500 mb-1">Token</label>
                <select
                  value={token}
                  onChange={(e) => {
                    setToken(e.target.value);
                    setEstimate(null);
                  }}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-blue-500"
                >
                  {tokens.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>

              {/* To Address */}
              <div>
                <label className="block text-xs text-gray-500 mb-1">To Address</label>
                <input
                  type="text"
                  value={toAddress}
                  onChange={(e) => {
                    setToAddress(e.target.value);
                    setEstimate(null);
                  }}
                  placeholder={chainType === "solana" ? "Solana address..." : "0x..."}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-600 font-mono focus:outline-none focus:border-blue-500"
                />
              </div>

              {/* Amount */}
              <div>
                <label className="block text-xs text-gray-500 mb-1">Amount</label>
                <input
                  type="text"
                  value={amount}
                  onChange={(e) => {
                    setAmount(e.target.value);
                    setEstimate(null);
                  }}
                  placeholder="0.00"
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-600 font-mono focus:outline-none focus:border-blue-500"
                />
              </div>

              {/* Estimate */}
              {estimate && (
                <div className="bg-gray-800 rounded-lg p-3 space-y-1 fade-in">
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-500">Estimated Fee</span>
                    <span className="text-gray-200 font-mono">
                      {estimate.fee} {estimate.feeToken}
                    </span>
                  </div>
                  {estimate.gasLimit && (
                    <div className="flex justify-between text-xs">
                      <span className="text-gray-500">Gas Limit</span>
                      <span className="text-gray-200 font-mono">{estimate.gasLimit}</span>
                    </div>
                  )}
                </div>
              )}

              {/* Error */}
              {error && (
                <div className="bg-red-900/30 border border-red-800 rounded-lg p-3 text-xs text-red-400">
                  {error}
                </div>
              )}

              {/* Buttons */}
              <div className="flex gap-3 pt-2">
                <button
                  onClick={handleEstimate}
                  disabled={!isFormValid || estimating}
                  className="flex-1 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg text-sm"
                >
                  {estimating ? "Estimating..." : "Estimate Fee"}
                </button>
                <button
                  onClick={handleSend}
                  disabled={!isFormValid || !estimate || sending}
                  className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg text-sm"
                >
                  {sending ? "Sending..." : "Confirm Send"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
