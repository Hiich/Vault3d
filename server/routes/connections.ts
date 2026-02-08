import { getDb } from "../db.ts";
import {
  scanAndComputeConnections,
  computeClusters,
} from "../services/connection-detector.ts";
import type { ConnectionRow } from "../services/connection-detector.ts";
import { liveScan } from "../services/transfer-fetcher.ts";

/**
 * POST /api/connections/scan
 * Trigger scan in the background, return immediately.
 */
export function postScan(_req: Request): Response {
  if (liveScan.scanning) {
    return Response.json({ error: "Scan already in progress" }, { status: 409 });
  }

  // Fire and forget — runs in background, progress polled via scan-state
  scanAndComputeConnections().catch((err) => {
    console.error("Background scan failed:", err);
  });

  return Response.json({ started: true });
}

/**
 * GET /api/connections/scan-state
 * Current scan progress summary + live progress if scanning.
 */
export function getScanStateSummary(_req: Request): Response {
  try {
    const db = getDb();

    const totalAddresses = (
      db.prepare(`SELECT COUNT(*) AS cnt FROM addresses`).get() as { cnt: number }
    ).cnt;

    const scannedAddresses = (
      db.prepare(`SELECT COUNT(DISTINCT address_id) AS cnt FROM scan_state`).get() as { cnt: number }
    ).cnt;

    const totalTransfers = (
      db.prepare(`SELECT COUNT(*) AS cnt FROM transfers`).get() as { cnt: number }
    ).cnt;

    const totalConnections = (
      db.prepare(`SELECT COUNT(*) AS cnt FROM connections`).get() as { cnt: number }
    ).cnt;

    const lastScan = db
      .prepare(`SELECT MAX(last_scanned_at) AS last FROM scan_state`)
      .get() as { last: string | null };

    return Response.json({
      totalAddresses,
      scannedAddresses,
      totalTransfers,
      totalConnections,
      lastScanAt: lastScan.last,
      scanning: liveScan.scanning,
      liveProgress: liveScan.progress,
      lastResult: liveScan.result,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ error: msg }, { status: 500 });
  }
}

/**
 * GET /api/connections/clusters
 * Computed clusters with member addresses and connections.
 */
export function getClusters(_req: Request): Response {
  try {
    const clusters = computeClusters();
    return Response.json({ clusters });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ error: msg }, { status: 500 });
  }
}

/**
 * GET /api/connections
 * Paginated connection list, filterable by type.
 */
export function listConnections(req: Request): Response {
  try {
    const url = new URL(req.url);
    const type = url.searchParams.get("type");
    const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1", 10));
    const limit = Math.min(200, Math.max(1, parseInt(url.searchParams.get("limit") ?? "50", 10)));
    const offset = (page - 1) * limit;

    const db = getDb();

    if (type) {
      const total = (
        db.prepare(`SELECT COUNT(*) AS cnt FROM connections c WHERE c.connection_type = $type`)
          .get({ $type: type }) as { cnt: number }
      ).cnt;

      const rows = db
        .prepare(
          `SELECT c.id, c.address_id_1, c.address_id_2, c.connection_type, c.evidence, c.created_at,
                  a1.address AS address_1, a1.chain_type AS chain_type_1,
                  a2.address AS address_2, a2.chain_type AS chain_type_2
           FROM connections c
           JOIN addresses a1 ON a1.id = c.address_id_1
           JOIN addresses a2 ON a2.id = c.address_id_2
           WHERE c.connection_type = $type
           ORDER BY c.id DESC
           LIMIT $limit OFFSET $offset`
        )
        .all({ $type: type, $limit: limit, $offset: offset }) as ConnectionRow[];

      return Response.json({
        connections: rows,
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      });
    }

    const total = (
      db.prepare(`SELECT COUNT(*) AS cnt FROM connections`).get() as { cnt: number }
    ).cnt;

    const rows = db
      .prepare(
        `SELECT c.id, c.address_id_1, c.address_id_2, c.connection_type, c.evidence, c.created_at,
                a1.address AS address_1, a1.chain_type AS chain_type_1,
                a2.address AS address_2, a2.chain_type AS chain_type_2
         FROM connections c
         JOIN addresses a1 ON a1.id = c.address_id_1
         JOIN addresses a2 ON a2.id = c.address_id_2
         ORDER BY c.id DESC
         LIMIT $limit OFFSET $offset`
      )
      .all({ $limit: limit, $offset: offset }) as ConnectionRow[];

    return Response.json({
      connections: rows,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ error: msg }, { status: 500 });
  }
}
