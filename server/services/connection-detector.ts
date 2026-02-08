import { getDb, insertConnection, clearConnections } from "../db.ts";
import { scanTransferHistory, liveScan } from "./transfer-fetcher.ts";

// --- Types ---

export interface ConnectionRow {
  id: number;
  address_id_1: number;
  address_id_2: number;
  connection_type: string;
  evidence: string;
  created_at: string;
  // Joined fields
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

export interface ScanResult {
  transfersFound: number;
  connectionsFound: number;
  clustersFound: number;
  errors: string[];
}

// --- Union-Find ---

class UnionFind {
  private parent: Map<number, number> = new Map();
  private rank: Map<number, number> = new Map();

  add(x: number): void {
    if (!this.parent.has(x)) {
      this.parent.set(x, x);
      this.rank.set(x, 0);
    }
  }

  find(x: number): number {
    let root = x;
    while (this.parent.get(root) !== root) {
      root = this.parent.get(root)!;
    }
    // Path compression
    let curr = x;
    while (curr !== root) {
      const next = this.parent.get(curr)!;
      this.parent.set(curr, root);
      curr = next;
    }
    return root;
  }

  union(x: number, y: number): void {
    const rx = this.find(x);
    const ry = this.find(y);
    if (rx === ry) return;

    const rankX = this.rank.get(rx)!;
    const rankY = this.rank.get(ry)!;
    if (rankX < rankY) {
      this.parent.set(rx, ry);
    } else if (rankX > rankY) {
      this.parent.set(ry, rx);
    } else {
      this.parent.set(ry, rx);
      this.rank.set(rx, rankX + 1);
    }
  }

  groups(): Map<number, number[]> {
    const groups = new Map<number, number[]>();
    for (const x of this.parent.keys()) {
      const root = this.find(x);
      if (!groups.has(root)) groups.set(root, []);
      groups.get(root)!.push(x);
    }
    return groups;
  }
}

// --- Connection Detection ---

function normalizeAddress(addr: string): string {
  if (addr.startsWith("0x")) return addr.toLowerCase();
  return addr;
}

export function detectConnections(): number {
  const db = getDb();

  // Build map of normalized address -> address_id for all extracted addresses
  const allAddresses = db
    .prepare(`SELECT id, address, chain_type FROM addresses`)
    .all() as Array<{ id: number; address: string; chain_type: string }>;

  const addressMap = new Map<string, number>();
  for (const a of allAddresses) {
    addressMap.set(normalizeAddress(a.address), a.id);
  }

  // Clear old connections before recomputing
  clearConnections();

  let connectionCount = 0;

  // --- Direct connections ---
  // Find transfers where both from and to are extracted addresses
  const transfers = db
    .prepare(`SELECT from_address, to_address, chain, token, tx_hash FROM transfers`)
    .all() as Array<{
    from_address: string;
    to_address: string;
    chain: string;
    token: string;
    tx_hash: string;
  }>;

  // Track unique direct pairs to avoid excessive evidence entries
  const directPairs = new Set<string>();

  for (const t of transfers) {
    const fromId = addressMap.get(normalizeAddress(t.from_address));
    const toId = addressMap.get(normalizeAddress(t.to_address));

    if (fromId !== undefined && toId !== undefined && fromId !== toId) {
      const pairKey = `${Math.min(fromId, toId)}-${Math.max(fromId, toId)}`;
      if (!directPairs.has(pairKey)) {
        directPairs.add(pairKey);
        const evidence = JSON.stringify({
          type: "direct_transfer",
          chain: t.chain,
          token: t.token,
          tx_hash: t.tx_hash,
        });
        insertConnection({
          address_id_1: fromId,
          address_id_2: toId,
          connection_type: "direct",
          evidence,
        });
        connectionCount++;
      }
    }
  }

  // --- Indirect connections ---
  // Build counterparty map: external address -> set of extracted address IDs
  const counterpartyMap = new Map<string, Set<number>>();

  for (const t of transfers) {
    const fromNorm = normalizeAddress(t.from_address);
    const toNorm = normalizeAddress(t.to_address);
    const fromId = addressMap.get(fromNorm);
    const toId = addressMap.get(toNorm);

    // One side is extracted, the other is external
    if (fromId !== undefined && toId === undefined) {
      if (!counterpartyMap.has(toNorm)) counterpartyMap.set(toNorm, new Set());
      counterpartyMap.get(toNorm)!.add(fromId);
    }
    if (toId !== undefined && fromId === undefined) {
      if (!counterpartyMap.has(fromNorm)) counterpartyMap.set(fromNorm, new Set());
      counterpartyMap.get(fromNorm)!.add(toId);
    }
  }

  // For each external address connected to 2-MAX_FANOUT extracted addresses, create indirect connections
  // Skip high-fanout addresses (DEX routers, bridges, etc.) that connect to many wallets
  const MAX_FANOUT = 10;
  for (const [externalAddr, addressIds] of counterpartyMap) {
    if (addressIds.size < 2 || addressIds.size > MAX_FANOUT) continue;

    const ids = [...addressIds];
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const evidence = JSON.stringify({
          type: "shared_counterparty",
          external_address: externalAddr,
        });
        insertConnection({
          address_id_1: ids[i]!,
          address_id_2: ids[j]!,
          connection_type: "indirect",
          evidence,
        });
        connectionCount++;
      }
    }
  }

  return connectionCount;
}

// --- Cluster Computation ---

export function computeClusters(): ClusterData[] {
  const db = getDb();

  const connections = db
    .prepare(
      `SELECT c.id, c.address_id_1, c.address_id_2, c.connection_type, c.evidence, c.created_at
       FROM connections c`
    )
    .all() as ConnectionRow[];

  if (connections.length === 0) return [];

  // Build Union-Find
  const uf = new UnionFind();

  // Add all address IDs, but only union on direct connections
  // Indirect connections are supplementary evidence, not clustering drivers
  for (const c of connections) {
    uf.add(c.address_id_1);
    uf.add(c.address_id_2);
    if (c.connection_type === "direct") {
      uf.union(c.address_id_1, c.address_id_2);
    }
  }

  // Group by root
  const groups = uf.groups();

  // Fetch address details for all involved address IDs
  const allIds = new Set<number>();
  for (const c of connections) {
    allIds.add(c.address_id_1);
    allIds.add(c.address_id_2);
  }

  const addressDetails = new Map<number, ClusterAddress>();
  if (allIds.size > 0) {
    const placeholders = [...allIds].map(() => "?").join(",");
    const rows = db
      .prepare(
        `SELECT a.id AS address_id, a.address, a.chain_type, a.wallet_id,
                w.type AS wallet_type, w.label AS wallet_label, w.profile AS wallet_profile
         FROM addresses a
         JOIN wallets w ON w.id = a.wallet_id
         WHERE a.id IN (${placeholders})`
      )
      .all(...allIds) as ClusterAddress[];
    for (const r of rows) {
      addressDetails.set(r.address_id, r);
    }
  }

  // Build clusters
  const clusters: ClusterData[] = [];
  let clusterId = 1;

  for (const [, memberIds] of groups) {
    if (memberIds.length < 2) continue;

    const memberSet = new Set(memberIds);

    // Include connections where both endpoints are in this cluster
    // (direct connections formed the cluster; indirect connections are supplementary)
    const clusterConnections = connections.filter(
      (c) => memberSet.has(c.address_id_1) && memberSet.has(c.address_id_2)
    );

    const clusterAddresses: ClusterAddress[] = [];
    for (const id of memberIds) {
      const detail = addressDetails.get(id);
      if (detail) clusterAddresses.push(detail);
    }

    clusters.push({
      id: clusterId++,
      addresses: clusterAddresses,
      connections: clusterConnections,
    });
  }

  // Sort by size descending
  clusters.sort((a, b) => b.addresses.length - a.addresses.length);

  return clusters;
}

// --- Full Orchestrator ---

export async function scanAndComputeConnections(): Promise<ScanResult> {
  if (liveScan.scanning) {
    throw new Error("Scan already in progress");
  }

  liveScan.scanning = true;
  liveScan.result = null;

  try {
    // Step 1: Fetch transfer history
    const scanProgress = await scanTransferHistory();

    // Step 2: Detect connections
    const connectionsFound = detectConnections();

    // Step 3: Compute clusters
    const clusters = computeClusters();

    const result: ScanResult = {
      transfersFound: scanProgress.transfersFound,
      connectionsFound,
      clustersFound: clusters.length,
      errors: scanProgress.errors,
    };

    liveScan.result = result;
    return result;
  } finally {
    liveScan.scanning = false;
    liveScan.progress = null;
  }
}
