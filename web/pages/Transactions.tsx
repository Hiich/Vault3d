import { useState, useEffect, useCallback } from "react";
import { getTransactions } from "../lib/api.ts";
import type { TxRecord } from "../lib/api.ts";
import { truncateAddress, formatBalance, chainBadgeColor, timeAgo } from "../lib/format.ts";

const explorerUrls: Record<string, string> = {
  ethereum: "https://etherscan.io/tx/",
  base: "https://basescan.org/tx/",
  polygon: "https://polygonscan.com/tx/",
  abstract: "https://abscan.org/tx/",
  solana: "https://solscan.io/tx/",
};

function statusBadge(status: string) {
  switch (status) {
    case "confirmed":
    case "success":
      return "bg-green-600/20 text-green-400 border-green-800";
    case "pending":
      return "bg-yellow-600/20 text-yellow-400 border-yellow-800";
    case "failed":
    case "error":
      return "bg-red-600/20 text-red-400 border-red-800";
    default:
      return "bg-gray-600/20 text-gray-400 border-gray-700";
  }
}

export function Transactions() {
  const [transactions, setTransactions] = useState<TxRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState("");
  const [filterChain, setFilterChain] = useState("");

  const fetchTransactions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params: Record<string, string> = {};
      if (filterStatus) params.status = filterStatus;
      if (filterChain) params.chain = filterChain;
      const data = await getTransactions(Object.keys(params).length > 0 ? params : undefined);
      setTransactions(data.transactions);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load transactions");
    } finally {
      setLoading(false);
    }
  }, [filterStatus, filterChain]);

  useEffect(() => {
    fetchTransactions();
  }, [fetchTransactions]);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold">Transactions</h2>
          <p className="text-sm text-gray-500 mt-1">
            {transactions.length} transaction{transactions.length !== 1 ? "s" : ""}
          </p>
        </div>
        <button
          onClick={fetchTransactions}
          className="text-xs text-gray-400 hover:text-gray-200 flex items-center gap-1"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" />
          </svg>
          Refresh
        </button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-6">
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-blue-500"
        >
          <option value="">All Statuses</option>
          <option value="pending">Pending</option>
          <option value="confirmed">Confirmed</option>
          <option value="success">Success</option>
          <option value="failed">Failed</option>
          <option value="error">Error</option>
        </select>
        <select
          value={filterChain}
          onChange={(e) => setFilterChain(e.target.value)}
          className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-blue-500"
        >
          <option value="">All Chains</option>
          <option value="ethereum">Ethereum</option>
          <option value="base">Base</option>
          <option value="polygon">Polygon</option>
          <option value="abstract">Abstract</option>
          <option value="solana">Solana</option>
        </select>
      </div>

      {error && (
        <div className="bg-red-900/30 border border-red-800 rounded-xl p-4 mb-6 text-sm text-red-400">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="text-gray-500 text-sm">Loading transactions...</div>
        </div>
      ) : transactions.length === 0 ? (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-12 text-center">
          <div className="text-gray-500 text-sm">No transactions found.</div>
        </div>
      ) : (
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-gray-500 text-xs uppercase border-b border-gray-800">
                  <th className="text-left px-4 py-2">Chain</th>
                  <th className="text-left px-4 py-2">Token</th>
                  <th className="text-left px-4 py-2">From</th>
                  <th className="text-left px-4 py-2">To</th>
                  <th className="text-right px-4 py-2">Amount</th>
                  <th className="text-left px-4 py-2">Tx Hash</th>
                  <th className="text-left px-4 py-2">Status</th>
                  <th className="text-right px-4 py-2">Time</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((tx) => (
                  <tr key={tx.id} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                    <td className="px-4 py-2">
                      <span className={`${chainBadgeColor(tx.chain)} text-white text-xs px-2 py-0.5 rounded-full`}>
                        {tx.chain}
                      </span>
                    </td>
                    <td className="px-4 py-2 font-medium">{tx.token}</td>
                    <td className="px-4 py-2 font-mono text-gray-400 text-xs">
                      {tx.from_address ? truncateAddress(tx.from_address) : "---"}
                    </td>
                    <td className="px-4 py-2 font-mono text-gray-300 text-xs">
                      {truncateAddress(tx.to_address)}
                    </td>
                    <td className="px-4 py-2 text-right font-mono">{formatBalance(tx.amount)}</td>
                    <td className="px-4 py-2">
                      {tx.tx_hash ? (
                        <a
                          href={`${explorerUrls[tx.chain] ?? ""}${tx.tx_hash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-400 hover:underline text-xs font-mono"
                        >
                          {truncateAddress(tx.tx_hash, 8)}
                        </a>
                      ) : (
                        <span className="text-xs text-gray-600">---</span>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      <span className={`${statusBadge(tx.status)} text-xs px-2 py-0.5 rounded-full border`}>
                        {tx.status}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right text-xs text-gray-500" title={tx.created_at}>
                      {timeAgo(tx.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
