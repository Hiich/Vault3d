import { useState, useEffect } from "react";
import { getBalanceSummary, refreshBalances } from "../lib/api.ts";
import type { BalanceSummary } from "../lib/api.ts";
import { formatBalance, chainBadgeColor } from "../lib/format.ts";

export function Dashboard() {
  const [summary, setSummary] = useState<BalanceSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchSummary = async () => {
    try {
      setError(null);
      const data = await getBalanceSummary();
      setSummary(data.summary);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load balances");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSummary();
  }, []);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await refreshBalances();
      await fetchSummary();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to refresh");
    } finally {
      setRefreshing(false);
    }
  };

  const nonZero = summary.filter((s) => parseFloat(s.total_balance) > 0);
  const totalAddresses = summary.reduce((sum, s) => sum + s.address_count, 0);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500 text-sm">Loading balances...</div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold">Dashboard</h2>
          <p className="text-sm text-gray-500 mt-1">Balance overview across all addresses</p>
        </div>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm flex items-center gap-2"
        >
          <svg className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" />
          </svg>
          {refreshing ? "Refreshing..." : "Refresh All Balances"}
        </button>
      </div>

      {error && (
        <div className="bg-red-900/30 border border-red-800 rounded-xl p-4 mb-6 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Summary cards */}
      {nonZero.length > 0 ? (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 mb-8">
            {nonZero.map((s) => (
              <div key={`${s.chain}-${s.token}`} className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-2">
                  <span className={`${chainBadgeColor(s.chain)} text-white text-xs px-2 py-0.5 rounded-full`}>
                    {s.chain}
                  </span>
                  <span className="text-sm font-semibold text-gray-200">{s.token}</span>
                </div>
                <div className="text-2xl font-bold text-gray-100">{formatBalance(s.total_balance)}</div>
                <div className="text-xs text-gray-500 mt-1">
                  across {s.address_count} address{s.address_count !== 1 ? "es" : ""}
                </div>
              </div>
            ))}
          </div>

          {/* Full table */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-800">
              <h3 className="text-sm font-semibold text-gray-300">All Non-Zero Balances</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-gray-500 text-xs uppercase border-b border-gray-800">
                    <th className="text-left px-4 py-2">Chain</th>
                    <th className="text-left px-4 py-2">Token</th>
                    <th className="text-right px-4 py-2">Total Balance</th>
                    <th className="text-right px-4 py-2">Addresses</th>
                  </tr>
                </thead>
                <tbody>
                  {nonZero.map((s) => (
                    <tr key={`${s.chain}-${s.token}`} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                      <td className="px-4 py-2">
                        <span className={`${chainBadgeColor(s.chain)} text-white text-xs px-2 py-0.5 rounded-full`}>
                          {s.chain}
                        </span>
                      </td>
                      <td className="px-4 py-2 font-medium">{s.token}</td>
                      <td className="px-4 py-2 text-right font-mono">{formatBalance(s.total_balance)}</td>
                      <td className="px-4 py-2 text-right text-gray-400">{s.address_count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-12 text-center">
          <div className="text-gray-500 text-sm mb-2">No balances found</div>
          <p className="text-xs text-gray-600">
            {totalAddresses === 0
              ? "Extract wallets first, then refresh balances."
              : "Try refreshing balances to fetch the latest data."}
          </p>
        </div>
      )}
    </div>
  );
}
