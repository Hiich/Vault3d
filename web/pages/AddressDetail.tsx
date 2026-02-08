import { useState, useEffect } from "react";
import { getAddressDetail, getWalletSensitive, deleteWallet, updateWalletLabel, refreshBalances } from "../lib/api.ts";
import type { AddressDetailData } from "../lib/api.ts";
import { truncateAddress, formatBalance, chainBadgeColor, typeBadgeColor, timeAgo } from "../lib/format.ts";
import { SendModal } from "../components/SendModal.tsx";

interface Props {
  addressId: number;
}

export function AddressDetail({ addressId }: Props) {
  const [address, setAddress] = useState<AddressDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sendModal, setSendModal] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Source key state
  const [sourceKeyOpen, setSourceKeyOpen] = useState(false);
  const [sensitive, setSensitive] = useState<{ mnemonic?: string; private_key?: string } | null>(null);
  const [showSensitive, setShowSensitive] = useState(false);
  const [loadingSensitive, setLoadingSensitive] = useState(false);

  // Label editing
  const [editingLabel, setEditingLabel] = useState(false);
  const [labelValue, setLabelValue] = useState("");

  // Delete
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const fetchAddress = () => {
    setLoading(true);
    setError(null);
    getAddressDetail(addressId)
      .then((data) => {
        setAddress(data.address);
        setLabelValue(data.address.wallet_label ?? "");
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchAddress();
    setSensitive(null);
    setShowSensitive(false);
    setSourceKeyOpen(false);
  }, [addressId]);

  const handleReveal = async () => {
    if (!address) return;
    if (sensitive) {
      setShowSensitive(!showSensitive);
      return;
    }
    setLoadingSensitive(true);
    try {
      const data = await getWalletSensitive(address.wallet_id);
      setSensitive(data);
      setShowSensitive(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load sensitive data");
    } finally {
      setLoadingSensitive(false);
    }
  };

  const handleSaveLabel = async () => {
    if (!address) return;
    try {
      await updateWalletLabel(address.wallet_id, labelValue);
      setAddress((prev) => prev ? { ...prev, wallet_label: labelValue || null } : prev);
      setEditingLabel(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed");
    }
  };

  const handleDelete = async () => {
    if (!address) return;
    setDeleting(true);
    try {
      await deleteWallet(address.wallet_id);
      window.location.hash = "#/addresses";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
      setDeleting(false);
    }
  };

  const handleRefresh = async () => {
    if (!address) return;
    setRefreshing(true);
    try {
      await refreshBalances([address.id]);
      fetchAddress();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Refresh failed");
    } finally {
      setRefreshing(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500 text-sm">Loading address...</div>
      </div>
    );
  }

  if (error && !address) {
    return (
      <div className="bg-red-900/30 border border-red-800 rounded-xl p-4 text-sm text-red-400">
        {error ?? "Address not found"}
      </div>
    );
  }

  if (!address) {
    return (
      <div className="bg-red-900/30 border border-red-800 rounded-xl p-4 text-sm text-red-400">
        Address not found
      </div>
    );
  }

  const nonZero = address.balances.filter((b) => parseFloat(b.balance) > 0);
  const zero = address.balances.filter((b) => parseFloat(b.balance) === 0);
  const sortedBalances = [...nonZero, ...zero];

  return (
    <div>
      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 text-sm text-gray-500 mb-4">
        <a href="#/addresses" className="hover:text-gray-300 transition-colors">Addresses</a>
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
        </svg>
        <span className="text-gray-300 font-mono">{truncateAddress(address.address, 8)}</span>
      </div>

      {error && (
        <div className="bg-red-900/30 border border-red-800 rounded-xl p-3 mb-4 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Header card */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 mb-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <span className={`${address.chain_type === "evm" ? "bg-blue-500/20 text-blue-400 border-blue-800" : "bg-purple-500/20 text-purple-400 border-purple-800"} text-xs px-2 py-0.5 rounded border`}>
              {address.chain_type}
            </span>
            <span className={`${typeBadgeColor(address.wallet_type)} text-white text-xs px-2 py-0.5 rounded-full`}>
              {address.wallet_type.replace("_", " ")}
            </span>
            <span className="text-xs text-gray-500">{address.wallet_profile}</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="text-xs bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-gray-300 px-3 py-1.5 rounded-lg"
            >
              {refreshing ? "Refreshing..." : "Refresh"}
            </button>
            <button
              onClick={() => setSendModal(true)}
              className="text-xs bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 border border-blue-800 px-3 py-1.5 rounded-lg"
            >
              Send
            </button>
            <button
              onClick={() => navigator.clipboard.writeText(address.address)}
              className="text-xs text-gray-500 hover:text-gray-300 bg-gray-800 hover:bg-gray-700 px-3 py-1.5 rounded-lg"
            >
              Copy
            </button>
          </div>
        </div>
        <div className="font-mono text-sm text-gray-200 bg-gray-800 rounded-lg px-3 py-2 select-all break-all">
          {address.address}
        </div>
        {address.derivation_index !== null && (
          <div className="text-xs text-gray-500 mt-2">
            Derivation index: {address.derivation_index}
          </div>
        )}
      </div>

      {/* Balance table */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden mb-6">
        <div className="px-4 py-3 border-b border-gray-800">
          <h3 className="text-sm font-semibold text-gray-300">
            Balances ({address.balances.length})
          </h3>
        </div>
        {address.balances.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-500">
            No balances recorded. Try refreshing balances.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 text-xs text-gray-500 uppercase tracking-wider">
                <th className="px-4 py-2.5 text-left">Chain</th>
                <th className="px-4 py-2.5 text-left">Token</th>
                <th className="px-4 py-2.5 text-right">Balance</th>
                <th className="px-4 py-2.5 text-right">Last Updated</th>
              </tr>
            </thead>
            <tbody>
              {sortedBalances.map((b) => {
                const isNonZero = parseFloat(b.balance) > 0;
                return (
                  <tr
                    key={`${b.chain}-${b.token}`}
                    className={`border-b border-gray-800/50 ${isNonZero ? "" : "opacity-40"}`}
                  >
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <span className={`${chainBadgeColor(b.chain)} w-2 h-2 rounded-full inline-block`} />
                        <span className="text-gray-300 capitalize">{b.chain}</span>
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-gray-300 font-mono text-xs">{b.token}</td>
                    <td className={`px-4 py-2.5 text-right font-mono text-xs ${isNonZero ? "text-gray-200" : "text-gray-600"}`}>
                      {formatBalance(b.balance)}
                    </td>
                    <td className="px-4 py-2.5 text-right text-xs text-gray-500">
                      {b.updated_at ? timeAgo(b.updated_at) : "--"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Source Key section */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        <button
          onClick={() => setSourceKeyOpen(!sourceKeyOpen)}
          className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-800/30 transition-colors"
        >
          <h3 className="text-sm font-semibold text-gray-300">Source Key</h3>
          <svg
            className={`w-4 h-4 text-gray-500 transition-transform ${sourceKeyOpen ? "rotate-180" : ""}`}
            fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
          </svg>
        </button>

        {sourceKeyOpen && (
          <div className="px-4 pb-4 border-t border-gray-800 pt-3 space-y-3">
            {/* Wallet info */}
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`${typeBadgeColor(address.wallet_type)} text-white text-xs px-2 py-0.5 rounded-full`}>
                {address.wallet_type.replace("_", " ")}
              </span>
              <span className="text-xs text-gray-500">{address.wallet_profile}</span>
              <span className="text-gray-700">·</span>
              {editingLabel ? (
                <div className="flex items-center gap-2">
                  <input
                    value={labelValue}
                    onChange={(e) => setLabelValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleSaveLabel();
                      if (e.key === "Escape") setEditingLabel(false);
                    }}
                    className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-0.5 text-sm text-gray-100 focus:outline-none focus:border-blue-500 w-36"
                    autoFocus
                  />
                  <button onClick={handleSaveLabel} className="text-xs text-blue-400 hover:text-blue-300">Save</button>
                  <button onClick={() => setEditingLabel(false)} className="text-xs text-gray-500 hover:text-gray-300">Cancel</button>
                </div>
              ) : (
                <span
                  className="text-sm text-gray-400 cursor-pointer hover:text-blue-400 transition-colors"
                  onClick={() => { setLabelValue(address.wallet_label ?? ""); setEditingLabel(true); }}
                  title="Click to edit label"
                >
                  {address.wallet_label || <span className="text-gray-600 italic">no label</span>}
                </span>
              )}
            </div>

            {/* Reveal / Hide */}
            <div className="flex items-center gap-2">
              <button
                onClick={handleReveal}
                disabled={loadingSensitive}
                className={`text-xs px-2.5 py-1 rounded-lg ${
                  showSensitive
                    ? "bg-gray-700 hover:bg-gray-600 text-gray-300"
                    : "bg-red-600/20 hover:bg-red-600/30 text-red-400 border border-red-800"
                }`}
              >
                {loadingSensitive ? "..." : showSensitive ? "Hide" : "Reveal Key"}
              </button>
            </div>

            {showSensitive && sensitive && (
              <div className="space-y-2">
                {sensitive.mnemonic && (
                  <div>
                    <div className="text-[10px] text-gray-500 mb-0.5">Mnemonic</div>
                    <div className="bg-gray-800 rounded-lg px-2.5 py-1.5 text-xs text-yellow-300 break-all select-all leading-relaxed">
                      {sensitive.mnemonic}
                    </div>
                  </div>
                )}
                {sensitive.private_key && (
                  <div>
                    <div className="text-[10px] text-gray-500 mb-0.5">Private Key</div>
                    <div className="bg-gray-800 rounded-lg px-2.5 py-1.5 text-xs text-yellow-300 break-all font-mono select-all">
                      {sensitive.private_key}
                    </div>
                  </div>
                )}
                {!sensitive.mnemonic && !sensitive.private_key && (
                  <div className="text-xs text-gray-600">No sensitive data available.</div>
                )}
              </div>
            )}

            {/* Delete wallet */}
            <div className="border-t border-gray-800 pt-3">
              {confirmDelete ? (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-red-400">Delete this wallet and all its addresses?</span>
                  <button
                    onClick={handleDelete}
                    disabled={deleting}
                    className="text-xs bg-red-600 hover:bg-red-700 text-white px-2 py-0.5 rounded"
                  >
                    {deleting ? "Deleting..." : "Confirm"}
                  </button>
                  <button
                    onClick={() => setConfirmDelete(false)}
                    className="text-xs text-gray-500 hover:text-gray-300"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setConfirmDelete(true)}
                  className="text-xs text-red-400 hover:text-red-300"
                >
                  Delete wallet...
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Send Modal */}
      {sendModal && (
        <SendModal
          fromAddressId={address.id}
          fromAddress={address.address}
          chainType={address.chain_type}
          onClose={() => setSendModal(false)}
          onSent={() => {
            setSendModal(false);
            fetchAddress();
          }}
        />
      )}
    </div>
  );
}
