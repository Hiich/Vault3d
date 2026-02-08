import { getDb } from "../db.ts";

/**
 * GET /api/addresses/:id
 * Returns a single address with wallet metadata and balances.
 */
export async function getAddressById(_req: Request, id: number): Promise<Response> {
  try {
    const db = getDb();

    const row = db.prepare(`
      SELECT
        a.id,
        a.wallet_id,
        a.address,
        a.chain_type,
        a.derivation_index,
        a.created_at,
        w.type AS wallet_type,
        w.profile AS wallet_profile,
        w.label AS wallet_label
      FROM addresses a
      JOIN wallets w ON w.id = a.wallet_id
      WHERE a.id = $id
    `).get({ $id: id }) as Record<string, unknown> | null;

    if (!row) {
      return Response.json({ error: "Address not found" }, { status: 404 });
    }

    const balances = db.prepare(`
      SELECT chain, token, balance, balance_raw, updated_at
      FROM balances
      WHERE address_id = $id
    `).all({ $id: id }) as Array<{ chain: string; token: string; balance: string; balance_raw: string; updated_at: string }>;

    return Response.json({
      address: {
        ...row,
        balances,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ error: msg }, { status: 500 });
  }
}

/**
 * GET /api/addresses
 * Query params:
 *   - chain_type: "evm" | "solana"
 *   - chain: specific chain name for balance filtering (e.g. "ethereum", "base")
 *   - token: token name for balance filtering (e.g. "ETH", "USDC")
 *   - min_balance: minimum balance (human-readable, e.g. "0.01")
 *   - sort: "balance_asc" | "balance_desc" | "created_at" (default: "created_at")
 *   - wallet_id: filter by wallet
 *   - page: page number (default 1)
 *   - limit: results per page (default 50)
 *
 * Returns addresses joined with wallets and optionally filtered/sorted by balance.
 */
export async function listAddresses(req: Request): Promise<Response> {
  try {
    const url = new URL(req.url);
    const chainType = url.searchParams.get("chain_type");
    const chain = url.searchParams.get("chain");
    const token = url.searchParams.get("token");
    const minBalance = url.searchParams.get("min_balance");
    const sort = url.searchParams.get("sort") ?? "created_at";
    const walletId = url.searchParams.get("wallet_id");
    const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1", 10));
    const limit = Math.min(200, Math.max(1, parseInt(url.searchParams.get("limit") ?? "50", 10)));
    const offset = (page - 1) * limit;

    const db = getDb();
    const conditions: string[] = [];
    const params: Record<string, string | number> = {};

    // Base query with optional balance join
    // We always left join balances so we can filter/sort by it
    let query = `
      SELECT
        a.id,
        a.wallet_id,
        a.address,
        a.chain_type,
        a.derivation_index,
        a.created_at,
        w.type AS wallet_type,
        w.profile AS wallet_profile,
        w.label AS wallet_label
    `;

    let fromClause = `
      FROM addresses a
      JOIN wallets w ON w.id = a.wallet_id
    `;

    // If filtering/sorting by balance, we need the balance join
    const needsBalance = chain || token || minBalance || sort.startsWith("balance");

    if (needsBalance) {
      // Add balance columns to select
      query += `,
        b.chain AS balance_chain,
        b.token AS balance_token,
        b.balance AS balance,
        b.balance_raw AS balance_raw,
        b.updated_at AS balance_updated_at
      `;

      fromClause += `
        LEFT JOIN balances b ON b.address_id = a.id
      `;

      if (chain) {
        conditions.push("b.chain = $chain");
        params.$chain = chain;
      }
      if (token) {
        conditions.push("b.token = $token");
        params.$token = token;
      }
      if (minBalance) {
        conditions.push("CAST(b.balance AS REAL) >= $min_balance");
        params.$min_balance = parseFloat(minBalance);
      }
    }

    if (chainType) {
      conditions.push("a.chain_type = $chain_type");
      params.$chain_type = chainType;
    }

    if (walletId) {
      conditions.push("a.wallet_id = $wallet_id");
      params.$wallet_id = parseInt(walletId, 10);
    }

    let whereClause = "";
    if (conditions.length > 0) {
      whereClause = `WHERE ${conditions.join(" AND ")}`;
    }

    // Sorting
    let orderClause: string;
    switch (sort) {
      case "balance_asc":
        orderClause = "ORDER BY CAST(b.balance AS REAL) ASC";
        break;
      case "balance_desc":
        orderClause = "ORDER BY CAST(b.balance AS REAL) DESC";
        break;
      default:
        orderClause = "ORDER BY a.created_at DESC";
    }

    // Count query
    const countSql = `SELECT COUNT(*) AS total ${fromClause} ${whereClause}`;
    const countResult = db.prepare(countSql).get(params) as { total: number };
    const total = countResult.total;

    // Main query
    const sql = `${query} ${fromClause} ${whereClause} ${orderClause} LIMIT $limit OFFSET $offset`;
    params.$limit = limit;
    params.$offset = offset;

    const addresses = db.prepare(sql).all(params);

    return Response.json({
      addresses,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ error: msg }, { status: 500 });
  }
}
