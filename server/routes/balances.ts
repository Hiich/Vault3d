import { getDb } from "../db.ts";
import { fetchAndStoreBalances } from "../services/balance-fetcher.ts";

/**
 * POST /api/balances/refresh
 * Body: { addressIds?: number[] }
 * Fetches fresh balances for the given addresses (or all if not specified)
 * and stores them in the DB.
 */
export async function postRefresh(req: Request): Promise<Response> {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      addressIds?: number[];
    };

    const result = await fetchAndStoreBalances(body.addressIds);

    return Response.json({
      updated: result.updated,
      errors: result.errors,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ error: `Balance refresh failed: ${msg}` }, { status: 500 });
  }
}

/**
 * GET /api/balances/summary
 * Returns aggregated balance totals grouped by chain and token.
 */
export async function getSummary(_req: Request): Promise<Response> {
  try {
    const db = getDb();

    const summary = db
      .prepare(
        `SELECT
          b.chain,
          b.token,
          COUNT(DISTINCT b.address_id) AS address_count,
          SUM(CAST(b.balance AS REAL)) AS total_balance,
          MIN(b.updated_at) AS oldest_update,
          MAX(b.updated_at) AS newest_update
        FROM balances b
        GROUP BY b.chain, b.token
        ORDER BY b.chain, b.token`
      )
      .all() as Array<{
        chain: string;
        token: string;
        address_count: number;
        total_balance: number;
        oldest_update: string;
        newest_update: string;
      }>;

    // Format total_balance to reasonable precision
    const formatted = summary.map((row) => ({
      ...row,
      total_balance: row.total_balance.toFixed(6),
    }));

    return Response.json({ summary: formatted });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ error: msg }, { status: 500 });
  }
}
