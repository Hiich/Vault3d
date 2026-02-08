import { useState, useEffect, useCallback, useMemo } from "react";
import { getWallets, deleteWallet, refreshBalances, getAllTokens } from "../lib/api.ts";
import type { WalletWithAddresses, BalanceEntry } from "../lib/api.ts";
import { truncateAddress, formatBalance, typeBadgeColor, abbreviateWalletType } from "../lib/format.ts";
import { BulkSendBar } from "../components/BulkSendBar.tsx";
import { SendModal } from "../components/SendModal.tsx";

// --- Types ---

interface FlatRow {
  addressId: number;
  address: string;
  chainType: string;
  derivationIndex: number | null;
  walletId: number;
  walletType: string;
  walletLabel: string | null;
  profile: string;
  balances: BalanceEntry[];
  nativeVal: number;
  nativeLabel: string;
  nativeSecondary?: string;
  tokenBalances: Record<string, number>;
}

type SortField = string | null;
type SortDir = "asc" | "desc";

// --- Helpers ---

// Native tokens that should appear in the "Native" column, not as separate token columns
const NATIVE_TOKENS = new Set(["ETH", "SOL", "POL"]);

function buildFlatRow(
  addr: { id: number; address: string; chain_type: string; derivation_index: number | null; balances: BalanceEntry[] },
  wallet: { id: number; type: string; label: string | null; profile: string },
): FlatRow {
  let nativeVal = 0;
  let pol = 0;
  let nativeLabel = "ETH";
  const tokenBalances: Record<string, number> = {};

  if (addr.chain_type === "solana") {
    nativeLabel = "SOL";
  }

  for (const b of addr.balances) {
    const v = parseFloat(b.balance);
    if (b.token === "ETH" || b.token === "SOL") {
      nativeVal += v;
    } else if (b.token === "POL") {
      pol += v;
    } else {
      // All non-native tokens go into tokenBalances
      tokenBalances[b.token] = (tokenBalances[b.token] ?? 0) + v;
    }
  }

  return {
    addressId: addr.id,
    address: addr.address,
    chainType: addr.chain_type,
    derivationIndex: addr.derivation_index,
    walletId: wallet.id,
    walletType: wallet.type,
    walletLabel: wallet.label,
    profile: wallet.profile,
    balances: addr.balances,
    nativeVal,
    nativeLabel,
    nativeSecondary: pol > 0.0001 ? `+${formatBalance(pol.toString())} POL` : undefined,
    tokenBalances,
  };
}

function hasAnyBalance(row: FlatRow): boolean {
  return row.nativeVal > 0 || Object.values(row.tokenBalances).some((v) => v > 0);
}

// --- Component ---

export function Addresses() {
  const [wallets, setWallets] = useState<WalletWithAddresses[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // Filters
  const [filterChain, setFilterChain] = useState<string>("all");
  const [filterSpecificChain, setFilterSpecificChain] = useState<string>("all");
  const [filterToken, setFilterToken] = useState<string>("all");
  const [filterMinBalance, setFilterMinBalance] = useState<string>("");
  const [filterType, setFilterType] = useState<string>("all");
  const [filterProfile, setFilterProfile] = useState<string>("all");
  const [hideZero, setHideZero] = useState(false);
  const [search, setSearch] = useState("");

  // Token map (dynamic)
  const [tokenMap, setTokenMap] = useState<Record<string, string[]>>({});

  // Send modal
  const [sendModal, setSendModal] = useState<{ addressId: number; address: string; chainType: string } | null>(null);

  // Sort
  const [sortField, setSortField] = useState<SortField>(null);
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  // Selection
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  // Expand
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());

  // Wallet actions
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const fetchWallets = useCallback(async () => {
    try {
      setError(null);
      const data = await getWallets();
      setWallets(data.wallets);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load addresses");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchWallets();
    getAllTokens().then((data) => setTokenMap(data.tokens)).catch(() => {});
  }, [fetchWallets]);

  // Build flat rows from wallet data
  const allRows = useMemo(() => {
    const rows: FlatRow[] = [];
    for (const w of wallets) {
      for (const addr of w.addresses) {
        rows.push(buildFlatRow(addr, w));
      }
    }
    return rows;
  }, [wallets]);

  // Get unique values for filters
  const profiles = useMemo(() => {
    const set = new Set<string>();
    for (const w of wallets) set.add(w.profile);
    return Array.from(set).sort();
  }, [wallets]);

  const walletTypes = useMemo(() => {
    const set = new Set<string>();
    for (const w of wallets) set.add(w.type);
    return Array.from(set).sort();
  }, [wallets]);

  // Derive non-native token columns from the token map
  const nonNativeTokens = useMemo(() => {
    const set = new Set<string>();
    for (const tokens of Object.values(tokenMap)) {
      for (const t of tokens) {
        if (!NATIVE_TOKENS.has(t)) set.add(t);
      }
    }
    return Array.from(set).sort();
  }, [tokenMap]);

  // All token names for filter dropdown (native + non-native)
  const allTokenNames = useMemo(() => {
    const set = new Set<string>();
    for (const tokens of Object.values(tokenMap)) {
      for (const t of tokens) set.add(t);
    }
    return Array.from(set).sort();
  }, [tokenMap]);

  // Available specific chains based on chain type filter
  const specificChainOptions = useMemo(() => {
    if (filterChain === "evm") return ["ethereum", "base", "polygon", "abstract"];
    if (filterChain === "solana") return ["solana"];
    return ["ethereum", "base", "polygon", "abstract", "solana"];
  }, [filterChain]);

  // Apply filters + sort
  const filteredRows = useMemo(() => {
    let rows = allRows;

    // Chain type filter
    if (filterChain !== "all") {
      rows = rows.filter((r) => r.chainType === filterChain);
    }

    // Specific chain filter
    if (filterSpecificChain !== "all") {
      rows = rows.filter((r) => r.balances.some((b) => b.chain === filterSpecificChain));
    }

    // Token filter
    if (filterToken !== "all") {
      rows = rows.filter((r) => r.balances.some((b) => b.token === filterToken && parseFloat(b.balance) > 0));
    }

    // Min balance filter
    if (filterMinBalance.trim()) {
      const min = parseFloat(filterMinBalance);
      if (!isNaN(min)) {
        rows = rows.filter((r) => {
          if (filterToken !== "all") {
            // Filter by specific token's total balance
            const total = r.balances
              .filter((b) => b.token === filterToken)
              .reduce((sum, b) => sum + parseFloat(b.balance), 0);
            return total >= min;
          }
          // Filter by native balance
          return r.nativeVal >= min;
        });
      }
    }

    // Wallet type filter
    if (filterType !== "all") {
      rows = rows.filter((r) => r.walletType === filterType);
    }

    // Profile filter
    if (filterProfile !== "all") {
      rows = rows.filter((r) => r.profile === filterProfile);
    }

    // Hide zero balances
    if (hideZero) {
      rows = rows.filter(hasAnyBalance);
    }

    // Search
    if (search.trim()) {
      const q = search.toLowerCase().trim();
      rows = rows.filter(
        (r) =>
          r.address.toLowerCase().includes(q) ||
          (r.walletLabel ?? "").toLowerCase().includes(q) ||
          `#${r.walletId}`.includes(q)
      );
    }

    // Sort
    if (sortField) {
      const mul = sortDir === "desc" ? -1 : 1;
      if (sortField === "native") {
        rows = [...rows].sort((a, b) => (a.nativeVal - b.nativeVal) * mul);
      } else {
        rows = [...rows].sort((a, b) => ((a.tokenBalances[sortField] ?? 0) - (b.tokenBalances[sortField] ?? 0)) * mul);
      }
    }

    return rows;
  }, [allRows, filterChain, filterSpecificChain, filterToken, filterMinBalance, filterType, filterProfile, hideZero, search, sortField, sortDir]);

  // Determine selected chain type for bulk send constraints
  const selectedChainType = useMemo(() => {
    if (selectedIds.size === 0) return null;
    const first = allRows.find((r) => selectedIds.has(r.addressId));
    return first?.chainType ?? null;
  }, [selectedIds, allRows]);

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      if (sortDir === "desc") setSortDir("asc");
      else { setSortField(null); setSortDir("desc"); }
    } else {
      setSortField(field);
      setSortDir("desc");
    }
  };

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    const eligible = filteredRows.filter(
      (r) => selectedChainType === null || r.chainType === selectedChainType
    );
    const allSelected = eligible.every((r) => selectedIds.has(r.addressId));
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      const next = new Set(selectedIds);
      for (const r of eligible) next.add(r.addressId);
      setSelectedIds(next);
    }
  };

  const handleDelete = async (id: number) => {
    setDeletingId(id);
    try {
      await deleteWallet(id);
      setWallets((prev) => prev.filter((w) => w.id !== id));
      setConfirmDeleteId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setDeletingId(null);
    }
  };

  const handleRefreshAll = async () => {
    setRefreshing(true);
    try {
      await refreshBalances();
      await fetchWallets();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Refresh failed");
    } finally {
      setRefreshing(false);
    }
  };

  const selectedRows = useMemo(() => {
    return allRows
      .filter((r) => selectedIds.has(r.addressId))
      .map((r) => ({ addressId: r.addressId, address: r.address, chainType: r.chainType }));
  }, [selectedIds, allRows]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500 text-sm">Loading addresses...</div>
      </div>
    );
  }

  const sortIcon = (field: SortField) => {
    if (sortField !== field) return <span className="text-gray-700 ml-1">&#8693;</span>;
    return <span className="text-blue-400 ml-1">{sortDir === "desc" ? "\u2193" : "\u2191"}</span>;
  };

  const activeFilters =
    (filterChain !== "all" ? 1 : 0) +
    (filterSpecificChain !== "all" ? 1 : 0) +
    (filterToken !== "all" ? 1 : 0) +
    (filterMinBalance.trim() ? 1 : 0) +
    (filterType !== "all" ? 1 : 0) +
    (filterProfile !== "all" ? 1 : 0) +
    (hideZero ? 1 : 0) +
    (search.trim() ? 1 : 0);

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-xl font-bold">Addresses</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            {filteredRows.length} of {allRows.length} addresses
            {activeFilters > 0 && <span className="text-blue-400 ml-1">({activeFilters} filter{activeFilters !== 1 ? "s" : ""} active)</span>}
          </p>
        </div>
        <button
          onClick={handleRefreshAll}
          disabled={refreshing}
          className="text-xs bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-gray-300 px-3 py-1.5 rounded-lg"
        >
          {refreshing ? "Refreshing..." : "Refresh Balances"}
        </button>
      </div>

      {/* Filter bar */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-3 mb-4 flex items-center gap-3 flex-wrap">
        {/* Search */}
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search address or label..."
          className="bg-gray-800 border border-gray-700 rounded-lg px-2.5 py-1.5 text-xs text-gray-100 placeholder-gray-600 focus:outline-none focus:border-blue-500 w-48"
        />

        <div className="h-5 w-px bg-gray-700" />

        {/* Chain */}
        <select
          value={filterChain}
          onChange={(e) => setFilterChain(e.target.value)}
          className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-xs text-gray-300 focus:outline-none focus:border-blue-500"
        >
          <option value="all">All chains</option>
          <option value="evm">EVM</option>
          <option value="solana">Solana</option>
        </select>

        {/* Specific chain */}
        <select
          value={filterSpecificChain}
          onChange={(e) => setFilterSpecificChain(e.target.value)}
          className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-xs text-gray-300 focus:outline-none focus:border-blue-500"
        >
          <option value="all">All networks</option>
          {specificChainOptions.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>

        {/* Token */}
        <select
          value={filterToken}
          onChange={(e) => setFilterToken(e.target.value)}
          className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-xs text-gray-300 focus:outline-none focus:border-blue-500"
        >
          <option value="all">All tokens</option>
          {allTokenNames.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>

        {/* Min balance */}
        <input
          type="text"
          value={filterMinBalance}
          onChange={(e) => setFilterMinBalance(e.target.value)}
          placeholder="Min balance"
          className="bg-gray-800 border border-gray-700 rounded-lg px-2.5 py-1.5 text-xs text-gray-100 placeholder-gray-600 focus:outline-none focus:border-blue-500 w-24"
        />

        <div className="h-5 w-px bg-gray-700" />

        {/* Wallet type */}
        <select
          value={filterType}
          onChange={(e) => setFilterType(e.target.value)}
          className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-xs text-gray-300 focus:outline-none focus:border-blue-500"
        >
          <option value="all">All types</option>
          {walletTypes.map((t) => (
            <option key={t} value={t}>{t.replace("_", " ")}</option>
          ))}
        </select>

        {/* Profile */}
        {profiles.length > 1 && (
          <select
            value={filterProfile}
            onChange={(e) => setFilterProfile(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-xs text-gray-300 focus:outline-none focus:border-blue-500"
          >
            <option value="all">All profiles</option>
            {profiles.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        )}

        {/* Hide zero */}
        <label className="flex items-center gap-1.5 text-xs text-gray-400 cursor-pointer whitespace-nowrap">
          <input
            type="checkbox"
            checked={hideZero}
            onChange={(e) => setHideZero(e.target.checked)}
            className="rounded bg-gray-700 border-gray-600 text-blue-500 focus:ring-blue-500 focus:ring-offset-0"
          />
          Hide zero
        </label>

        {activeFilters > 0 && (
          <button
            onClick={() => {
              setFilterChain("all");
              setFilterSpecificChain("all");
              setFilterToken("all");
              setFilterMinBalance("");
              setFilterType("all");
              setFilterProfile("all");
              setHideZero(false);
              setSearch("");
            }}
            className="text-xs text-gray-500 hover:text-gray-300 ml-auto"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Bulk send bar */}
      {selectedIds.size > 0 && (
        <BulkSendBar
          selectedRows={selectedRows}
          tokenMap={tokenMap}
          onClearSelection={() => setSelectedIds(new Set())}
          onComplete={() => {
            setSelectedIds(new Set());
            fetchWallets();
          }}
        />
      )}

      {error && (
        <div className="bg-red-900/30 border border-red-800 rounded-xl p-4 mb-4 text-sm text-red-400">
          {error}
        </div>
      )}

      {allRows.length === 0 ? (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-12 text-center">
          <div className="text-gray-500 text-sm mb-2">No addresses found</div>
          <p className="text-xs text-gray-600">
            Go to{" "}
            <a href="#/extract" className="text-blue-400 hover:underline">Extract</a>
            {" "}to discover and extract wallet data.
          </p>
        </div>
      ) : (
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden overflow-x-auto">
          <table className="w-full text-sm min-w-[700px]">
            <thead>
              <tr className="border-b border-gray-800 text-xs text-gray-500 uppercase tracking-wider">
                <th className="px-3 py-2.5 text-left w-8">
                  <input
                    type="checkbox"
                    checked={filteredRows.length > 0 && filteredRows.every((r) => selectedIds.has(r.addressId))}
                    onChange={toggleSelectAll}
                    className="rounded bg-gray-700 border-gray-600 text-blue-500 focus:ring-blue-500 focus:ring-offset-0 cursor-pointer"
                  />
                </th>
                <th className="px-3 py-2.5 text-left">Address</th>
                <th
                  className="px-3 py-2.5 text-right cursor-pointer hover:text-gray-300 select-none"
                  onClick={() => toggleSort("native")}
                >
                  Native{sortIcon("native")}
                </th>
                {nonNativeTokens.map((token) => (
                  <th
                    key={token}
                    className="px-3 py-2.5 text-right cursor-pointer hover:text-gray-300 select-none whitespace-nowrap"
                    onClick={() => toggleSort(token)}
                  >
                    {token}{sortIcon(token)}
                  </th>
                ))}
                <th className="px-3 py-2.5 text-center">Chain</th>
                <th className="px-3 py-2.5 text-right w-24"></th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.length === 0 ? (
                <tr>
                  <td colSpan={5 + nonNativeTokens.length} className="px-3 py-8 text-center text-sm text-gray-500">
                    No addresses match your filters.
                  </td>
                </tr>
              ) : (
                filteredRows.map((row) => (
                  <FlatAddressRow
                    key={row.addressId}
                    row={row}
                    nonNativeTokens={nonNativeTokens}
                    selected={selectedIds.has(row.addressId)}
                    disabled={selectedChainType !== null && selectedChainType !== row.chainType}
                    expanded={expandedIds.has(row.addressId)}
                    confirmDelete={confirmDeleteId === row.walletId}
                    deleting={deletingId === row.walletId}
                    onToggleSelect={() => toggleSelect(row.addressId)}
                    onToggleExpand={() =>
                      setExpandedIds((prev) => {
                        const next = new Set(prev);
                        if (next.has(row.addressId)) next.delete(row.addressId);
                        else next.add(row.addressId);
                        return next;
                      })
                    }
                    onConfirmDelete={() => setConfirmDeleteId(row.walletId)}
                    onCancelDelete={() => setConfirmDeleteId(null)}
                    onDelete={() => handleDelete(row.walletId)}
                    onSend={() => setSendModal({ addressId: row.addressId, address: row.address, chainType: row.chainType })}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Send modal */}
      {sendModal && (
        <SendModal
          fromAddressId={sendModal.addressId}
          fromAddress={sendModal.address}
          chainType={sendModal.chainType}
          tokenMap={tokenMap}
          onClose={() => setSendModal(null)}
          onSent={() => {
            setSendModal(null);
            fetchWallets();
          }}
        />
      )}
    </div>
  );
}

// --- Flat address row ---

interface FlatAddressRowProps {
  row: FlatRow;
  nonNativeTokens: string[];
  selected: boolean;
  disabled: boolean;
  expanded: boolean;
  confirmDelete: boolean;
  deleting: boolean;
  onToggleSelect: () => void;
  onToggleExpand: () => void;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
  onDelete: () => void;
  onSend: () => void;
}

function FlatAddressRow({
  row,
  nonNativeTokens,
  selected,
  disabled,
  expanded,
  confirmDelete,
  deleting,
  onToggleSelect,
  onToggleExpand,
  onConfirmDelete,
  onCancelDelete,
  onDelete,
  onSend,
}: FlatAddressRowProps) {
  const hasBalances = row.balances.length > 0;

  // Group balances by chain for expanded view
  const balancesByChain = useMemo(() => {
    const map = new Map<string, BalanceEntry[]>();
    for (const b of row.balances) {
      const list = map.get(b.chain) ?? [];
      list.push(b);
      map.set(b.chain, list);
    }
    return map;
  }, [row.balances]);

  return (
    <>
      <tr className={`border-b border-gray-800/50 hover:bg-gray-800/30 ${selected ? "bg-blue-900/20" : ""}`}>
        {/* Checkbox */}
        <td className="px-3 py-2">
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggleSelect}
            disabled={disabled}
            className="rounded bg-gray-700 border-gray-600 text-blue-500 focus:ring-blue-500 focus:ring-offset-0 disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed"
            title={disabled ? "Can only bulk-send same chain type" : "Select for bulk send"}
          />
        </td>

        {/* Address + wallet info */}
        <td className="px-3 py-2">
          <div className="flex items-center gap-2">
            {hasBalances ? (
              <button onClick={onToggleExpand} className="text-gray-500 hover:text-gray-300 p-0.5 -ml-1 flex-shrink-0">
                <svg
                  className={`w-3 h-3 transition-transform ${expanded ? "rotate-90" : ""}`}
                  fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                </svg>
              </button>
            ) : (
              <span className="w-3 -ml-1 flex-shrink-0" />
            )}
            <a
              href={`#/addresses/${row.addressId}`}
              className="font-mono text-gray-200 text-xs hover:text-blue-400 transition-colors"
              title={row.address}
            >
              {truncateAddress(row.address, 8)}
            </a>
            <button
              onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(row.address); }}
              className="text-gray-600 hover:text-gray-300 p-0.5"
              title="Copy address"
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9.75a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184" />
              </svg>
            </button>
            <span className={`${typeBadgeColor(row.walletType)} text-white px-1.5 py-px rounded text-[10px] leading-tight flex-shrink-0`}>
              {abbreviateWalletType(row.walletType)}
            </span>
            <span className="text-[10px] text-gray-600 flex-shrink-0">{row.profile}</span>
            {row.walletLabel && (
              <span className="text-xs text-gray-500 truncate max-w-[120px]" title={row.walletLabel}>
                {row.walletLabel}
              </span>
            )}
          </div>
        </td>

        {/* Native */}
        <td className="px-3 py-2 text-right">
          <div className={`text-xs font-mono ${row.nativeVal > 0 ? "text-gray-200" : "text-gray-600"}`}>
            {row.nativeVal > 0 ? formatBalance(row.nativeVal.toString()) : "0.00"}
            <span className="text-gray-500 ml-0.5">{row.nativeLabel}</span>
          </div>
          {row.nativeSecondary && (
            <div className="text-xs text-gray-500 font-mono">{row.nativeSecondary}</div>
          )}
        </td>

        {/* Dynamic token columns */}
        {nonNativeTokens.map((token) => {
          const val = row.tokenBalances[token] ?? 0;
          return (
            <td key={token} className="px-3 py-2 text-right">
              <span className={`text-xs font-mono ${val > 0 ? "text-gray-200" : "text-gray-600"}`}>
                {val > 0 ? formatBalance(val.toString()) : "--"}
              </span>
            </td>
          );
        })}

        {/* Chain */}
        <td className="px-3 py-2 text-center">
          <span className={`text-xs px-1.5 py-0.5 rounded ${row.chainType === "evm" ? "bg-blue-500/20 text-blue-400" : "bg-purple-500/20 text-purple-400"}`}>
            {row.chainType}
          </span>
        </td>

        {/* Actions */}
        <td className="px-3 py-2 text-right">
          <div className="flex items-center justify-end gap-1">
            {confirmDelete ? (
              <>
                <button
                  onClick={onDelete}
                  disabled={deleting}
                  className="text-xs bg-red-600 hover:bg-red-700 text-white px-1.5 py-0.5 rounded"
                >
                  {deleting ? "..." : "Del"}
                </button>
                <button
                  onClick={onCancelDelete}
                  className="text-xs text-gray-500 hover:text-gray-300 px-1"
                >
                  No
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={onSend}
                  className="text-xs text-green-400 hover:text-green-300"
                >
                  Send
                </button>
                <button
                  onClick={onConfirmDelete}
                  className="text-gray-700 hover:text-red-400 p-0.5 ml-1"
                  title="Delete wallet"
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                  </svg>
                </button>
              </>
            )}
          </div>
        </td>
      </tr>

      {/* Expanded per-chain breakdown */}
      {expanded && hasBalances &&
        Array.from(balancesByChain.entries()).map(([chain, chainBalances]) => (
          <tr key={`${row.addressId}-${chain}`} className="bg-gray-800/20 border-b border-gray-800/30">
            <td></td>
            <td className="px-3 py-1 pl-10">
              <span className="text-xs text-gray-500">{chain}</span>
            </td>
            <td className="px-3 py-1 text-right">
              {chainBalances
                .filter((b) => NATIVE_TOKENS.has(b.token))
                .map((b) => (
                  <div key={b.token} className="text-xs font-mono text-gray-400">
                    {formatBalance(b.balance)} <span className="text-gray-600">{b.token}</span>
                  </div>
                ))}
            </td>
            {nonNativeTokens.map((token) => {
              const match = chainBalances.filter((b) => b.token === token);
              return (
                <td key={token} className="px-3 py-1 text-right">
                  {match.map((b) => (
                    <div key={b.token} className="text-xs font-mono text-gray-400">
                      {formatBalance(b.balance)}
                    </div>
                  ))}
                </td>
              );
            })}
            <td></td>
            <td></td>
          </tr>
        ))}
    </>
  );
}
