const BASE = "";

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${url}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...options?.headers },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((body as { error?: string }).error ?? res.statusText);
  }
  return res.json() as Promise<T>;
}

// --- Profiles / Extraction ---
export const getProfiles = () => request<{ profiles: string[] }>("/api/profiles");

export const extractWallets = (body: {
  metamaskPassword?: string;
  phantomPassword?: string;
}) => request<{ wallets: number; addresses: number; errors: string[] }>("/api/extract", {
  method: "POST",
  body: JSON.stringify(body),
});

export const extractProfile = (body: {
  profile: string;
  metamaskPassword?: string;
  phantomPassword?: string;
}) => request<{ wallets: number; addresses: number; errors: string[] }>("/api/extract/profile", {
  method: "POST",
  body: JSON.stringify(body),
});

// --- Wallets ---
export interface WalletSummary {
  id: number;
  type: string;
  profile: string;
  label: string | null;
  extracted_at: string;
  address_count: number;
  total_balance_usd: string | null;
}

export interface WalletWithAddresses extends WalletSummary {
  addresses: AddressWithBalances[];
}

export interface WalletDetail extends WalletSummary {
  addresses: AddressWithBalances[];
}

export interface AddressWithBalances {
  id: number;
  address: string;
  chain_type: string;
  derivation_index: number | null;
  balances: BalanceEntry[];
}

export interface BalanceEntry {
  chain: string;
  token: string;
  balance: string;
  balance_raw: string;
  updated_at: string;
}

export const getWallets = () => request<{ wallets: WalletWithAddresses[] }>("/api/wallets");

export const getWallet = (id: number) => request<{ wallet: WalletDetail }>(`/api/wallets/${id}`);

export const getWalletSensitive = (id: number) =>
  request<{ mnemonic?: string; private_key?: string }>(`/api/wallets/${id}/sensitive`);

export interface ConnectedWallet {
  wallet_id: number;
  wallet_type: string;
  wallet_label: string | null;
  wallet_profile: string;
  directCount: number;
  indirectCount: number;
  connectedAddresses: string[];
}

export const getWalletConnections = (id: number) =>
  request<{ connectedWallets: ConnectedWallet[] }>(`/api/wallets/${id}/connections`);

export const deleteWallet = (id: number) =>
  request<{ success: boolean }>(`/api/wallets/${id}`, { method: "DELETE" });

export const updateWalletLabel = (id: number, label: string) =>
  request<{ success: boolean }>(`/api/wallets/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ label }),
  });

// --- Addresses ---
export interface AddressRow {
  id: number;
  address: string;
  chain_type: string;
  derivation_index: number | null;
  wallet_id: number;
  wallet_type: string;
  wallet_label: string | null;
  wallet_profile?: string;
  // Balance fields are optional flat columns from the SQL join
  balance_chain?: string;
  balance_token?: string;
  balance?: string;
  balance_raw?: string;
  balance_updated_at?: string;
}

export interface AddressesResponse {
  addresses: AddressRow[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface AddressDetailData {
  id: number;
  address: string;
  chain_type: string;
  derivation_index: number | null;
  wallet_id: number;
  wallet_type: string;
  wallet_profile: string;
  wallet_label: string | null;
  balances: BalanceEntry[];
}

export const getAddressDetail = (id: number) =>
  request<{ address: AddressDetailData }>(`/api/addresses/${id}`);

export const getAddresses = (params?: Record<string, string>) => {
  const qs = params ? "?" + new URLSearchParams(params).toString() : "";
  return request<AddressesResponse>(`/api/addresses${qs}`);
};

// --- Balances ---
export interface BalanceSummary {
  chain: string;
  token: string;
  total_balance: string;
  address_count: number;
  oldest_update?: string;
  newest_update?: string;
}

export const refreshBalances = (addressIds?: number[]) =>
  request<{ updated: number }>("/api/balances/refresh", {
    method: "POST",
    body: JSON.stringify({ addressIds }),
  });

export const getBalanceSummary = () =>
  request<{ summary: BalanceSummary[] }>("/api/balances/summary");

// --- Transactions ---
export interface TxEstimate {
  fee: string;
  feeToken: string;
  gasLimit?: string;
}

export interface TxRecord {
  id: number;
  address_id: number;
  chain: string;
  token: string;
  to_address: string;
  amount: string;
  tx_hash: string | null;
  status: string;
  error: string | null;
  created_at: string;
  from_address?: string;
}

export const estimateTx = (body: {
  fromAddressId: number;
  toAddress: string;
  chain: string;
  token: string;
  amount: string;
}) => request<TxEstimate>("/api/tx/estimate", { method: "POST", body: JSON.stringify(body) });

export const sendTx = (body: {
  fromAddressId: number;
  toAddress: string;
  chain: string;
  token: string;
  amount: string;
}) => request<{ txHash: string; txId: number }>("/api/tx/send", { method: "POST", body: JSON.stringify(body) });

export const getTransactions = (params?: Record<string, string>) => {
  const qs = params ? "?" + new URLSearchParams(params).toString() : "";
  return request<{ transactions: TxRecord[] }>(`/api/tx${qs}`);
};

// --- Connections ---
export interface ConnectionRow {
  id: number;
  address_id_1: number;
  address_id_2: number;
  connection_type: string;
  evidence: string;
  created_at: string;
  address_1?: string;
  address_2?: string;
  chain_type_1?: string;
  chain_type_2?: string;
}

export interface ClusterAddress {
  address_id: number;
  address: string;
  chain_type: string;
  wallet_id: number;
  wallet_type: string;
  wallet_label: string | null;
  wallet_profile: string;
}

export interface ClusterData {
  id: number;
  addresses: ClusterAddress[];
  connections: ConnectionRow[];
}

export interface LiveProgress {
  addressesScanned: number;
  addressesTotal: number;
  transfersFound: number;
  currentAddress: string;
  currentChain: string;
  errors: string[];
}

export interface ScanResult {
  transfersFound: number;
  connectionsFound: number;
  clustersFound: number;
  errors: string[];
}

export interface ScanStateData {
  totalAddresses: number;
  scannedAddresses: number;
  totalTransfers: number;
  totalConnections: number;
  lastScanAt: string | null;
  scanning: boolean;
  liveProgress: LiveProgress | null;
  lastResult: ScanResult | null;
}

export const scanConnections = () =>
  request<{ started: boolean }>("/api/connections/scan", { method: "POST" });

export const getScanState = () =>
  request<ScanStateData>("/api/connections/scan-state");

export const getClusters = () =>
  request<{ clusters: ClusterData[] }>("/api/connections/clusters");

export const getConnections = (params?: Record<string, string>) => {
  const qs = params ? "?" + new URLSearchParams(params).toString() : "";
  return request<{
    connections: ConnectionRow[];
    pagination: { page: number; limit: number; total: number; totalPages: number };
  }>(`/api/connections${qs}`);
};

// --- Bulk Send ---
export interface BulkTransferItem {
  fromAddressId: number;
  toAddress: string;
  chain: string;
  token: string;
  amount: string; // "max" to sweep full balance
}

export interface BulkSendResult {
  results: Array<{
    fromAddressId: number;
    txHash?: string;
    txId?: number;
    status: "confirmed" | "failed";
    error?: string;
  }>;
  summary: { total: number; succeeded: number; failed: number };
}

export const bulkSend = (transfers: BulkTransferItem[]) =>
  request<BulkSendResult>("/api/tx/bulk-send", {
    method: "POST",
    body: JSON.stringify({ transfers }),
  });
