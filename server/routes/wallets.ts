import { getDb } from "../db.ts";

interface AddressWithBalances {
  id: number;
  address: string;
  chain_type: string;
  derivation_index: number | null;
  created_at: string;
  balances: Array<{
    chain: string;
    token: string;
    balance: string;
    balance_raw: string;
    updated_at: string;
  }>;
}

interface AddressBalanceRow {
  address_id: number;
  wallet_id: number;
  address: string;
  chain_type: string;
  derivation_index: number | null;
  chain: string | null;
  token: string | null;
  balance: string | null;
  balance_raw: string | null;
}

/**
 * GET /api/wallets
 * Returns all wallets with nested addresses and balances.
 */
export async function listWallets(_req: Request): Promise<Response> {
  try {
    const db = getDb();

    // Query 1: All wallets
    const walletRows = db
      .prepare(
        `SELECT id, type, profile, label, extracted_at, created_at
         FROM wallets ORDER BY profile, created_at DESC`
      )
      .all() as Array<{
        id: number;
        type: string;
        profile: string;
        label: string | null;
        extracted_at: string;
        created_at: string;
      }>;

    // Query 2: All addresses + balances via JOIN
    const abRows = db
      .prepare(
        `SELECT a.id AS address_id, a.wallet_id, a.address, a.chain_type, a.derivation_index,
                b.chain, b.token, b.balance, b.balance_raw
         FROM addresses a
         LEFT JOIN balances b ON b.address_id = a.id
         ORDER BY a.wallet_id, a.derivation_index ASC NULLS LAST, a.id, b.chain, b.token`
      )
      .all() as AddressBalanceRow[];

    // Assemble in-memory: group addresses by wallet, then balances by address
    const addressMap = new Map<number, Map<number, AddressWithBalances>>();

    for (const row of abRows) {
      if (!addressMap.has(row.wallet_id)) {
        addressMap.set(row.wallet_id, new Map());
      }
      const walletAddrs = addressMap.get(row.wallet_id)!;

      if (!walletAddrs.has(row.address_id)) {
        walletAddrs.set(row.address_id, {
          id: row.address_id,
          address: row.address,
          chain_type: row.chain_type,
          derivation_index: row.derivation_index,
          created_at: "",
          balances: [],
        });
      }

      if (row.chain && row.token && row.balance) {
        walletAddrs.get(row.address_id)!.balances.push({
          chain: row.chain,
          token: row.token,
          balance: row.balance,
          balance_raw: row.balance_raw ?? "0x0",
          updated_at: "",
        });
      }
    }

    const wallets = walletRows.map((w) => {
      const addrs = addressMap.get(w.id);
      const addresses = addrs ? Array.from(addrs.values()) : [];
      return { ...w, address_count: addresses.length, addresses };
    });

    return Response.json({ wallets });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ error: msg }, { status: 500 });
  }
}

/**
 * GET /api/wallets/:id
 * Returns wallet detail with addresses and their balances.
 */
export async function getWalletById(_req: Request, id: number): Promise<Response> {
  try {
    const db = getDb();

    const wallet = db
      .prepare(
        `SELECT id, type, profile, label, extracted_at, created_at
         FROM wallets WHERE id = ?`
      )
      .get(id) as {
        id: number;
        type: string;
        profile: string;
        label: string | null;
        extracted_at: string;
        created_at: string;
      } | null;

    if (!wallet) {
      return Response.json({ error: "Wallet not found" }, { status: 404 });
    }

    // Fetch addresses
    const addresses = db
      .prepare(
        `SELECT id, address, chain_type, derivation_index, created_at
         FROM addresses WHERE wallet_id = ?
         ORDER BY derivation_index ASC NULLS LAST, id ASC`
      )
      .all(id) as Array<{
        id: number;
        address: string;
        chain_type: string;
        derivation_index: number | null;
        created_at: string;
      }>;

    // Fetch balances for each address
    const addressesWithBalances: AddressWithBalances[] = addresses.map((addr) => {
      const balances = db
        .prepare(
          `SELECT chain, token, balance, balance_raw, updated_at
           FROM balances WHERE address_id = ?
           ORDER BY chain, token`
        )
        .all(addr.id) as Array<{
          chain: string;
          token: string;
          balance: string;
          balance_raw: string;
          updated_at: string;
        }>;

      return { ...addr, balances };
    });

    return Response.json({ wallet: { ...wallet, addresses: addressesWithBalances } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ error: msg }, { status: 500 });
  }
}

/**
 * GET /api/wallets/:id/sensitive
 * Returns the wallet's sensitive data (mnemonic and/or private key).
 */
export async function getWalletSensitiveById(_req: Request, id: number): Promise<Response> {
  try {
    const db = getDb();

    const wallet = db
      .prepare(`SELECT mnemonic, private_key FROM wallets WHERE id = ?`)
      .get(id) as { mnemonic: string | null; private_key: string | null } | null;

    if (!wallet) {
      return Response.json({ error: "Wallet not found" }, { status: 404 });
    }

    const result: Record<string, string> = {};
    if (wallet.mnemonic) result.mnemonic = wallet.mnemonic;
    if (wallet.private_key) result.private_key = wallet.private_key;

    return Response.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ error: msg }, { status: 500 });
  }
}

/**
 * DELETE /api/wallets/:id
 * Deletes a wallet by ID (cascades to addresses, balances, transactions).
 */
export async function deleteWalletById(_req: Request, id: number): Promise<Response> {
  try {
    const db = getDb();

    const existing = db.prepare(`SELECT id FROM wallets WHERE id = ?`).get(id);
    if (!existing) {
      return Response.json({ error: "Wallet not found" }, { status: 404 });
    }

    db.prepare(`DELETE FROM wallets WHERE id = ?`).run(id);

    return Response.json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ error: msg }, { status: 500 });
  }
}

/**
 * PATCH /api/wallets/:id
 * Updates the wallet label.
 * Body: { label: string }
 */
export async function patchWalletById(req: Request, id: number): Promise<Response> {
  try {
    const body = (await req.json()) as { label?: string };

    if (body.label === undefined) {
      return Response.json({ error: "Missing 'label' field" }, { status: 400 });
    }

    const db = getDb();

    const existing = db.prepare(`SELECT id FROM wallets WHERE id = ?`).get(id);
    if (!existing) {
      return Response.json({ error: "Wallet not found" }, { status: 404 });
    }

    db.prepare(`UPDATE wallets SET label = ? WHERE id = ?`).run(body.label, id);

    return Response.json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ error: msg }, { status: 500 });
  }
}

/**
 * GET /api/wallets/:id/connections
 * Returns wallets connected to this wallet via the connections table,
 * with transfer counts and connection types.
 */
export function getWalletConnections(_req: Request, id: number): Response {
  try {
    const db = getDb();

    // Get all address IDs belonging to this wallet
    const myAddresses = db
      .prepare(`SELECT id FROM addresses WHERE wallet_id = ?`)
      .all(id) as Array<{ id: number }>;

    if (myAddresses.length === 0) {
      return Response.json({ connectedWallets: [] });
    }

    const myIds = myAddresses.map((a) => a.id);
    const placeholders = myIds.map(() => "?").join(",");

    // Find all connections involving any of this wallet's addresses
    const connections = db
      .prepare(
        `SELECT c.address_id_1, c.address_id_2, c.connection_type, c.evidence
         FROM connections c
         WHERE c.address_id_1 IN (${placeholders}) OR c.address_id_2 IN (${placeholders})`
      )
      .all(...myIds, ...myIds) as Array<{
      address_id_1: number;
      address_id_2: number;
      connection_type: string;
      evidence: string;
    }>;

    if (connections.length === 0) {
      return Response.json({ connectedWallets: [] });
    }

    // Collect the "other side" address IDs
    const myIdSet = new Set(myIds);
    const otherAddressIds = new Set<number>();
    for (const c of connections) {
      if (myIdSet.has(c.address_id_1)) otherAddressIds.add(c.address_id_2);
      if (myIdSet.has(c.address_id_2)) otherAddressIds.add(c.address_id_1);
    }
    // Remove own addresses (self-connections)
    for (const myId of myIds) otherAddressIds.delete(myId);

    if (otherAddressIds.size === 0) {
      return Response.json({ connectedWallets: [] });
    }

    // Map other address IDs to their wallets
    const otherIds = [...otherAddressIds];
    const otherPlaceholders = otherIds.map(() => "?").join(",");
    const otherAddressRows = db
      .prepare(
        `SELECT a.id AS address_id, a.address, a.chain_type, a.wallet_id,
                w.type AS wallet_type, w.label AS wallet_label, w.profile AS wallet_profile
         FROM addresses a
         JOIN wallets w ON w.id = a.wallet_id
         WHERE a.id IN (${otherPlaceholders})`
      )
      .all(...otherIds) as Array<{
      address_id: number;
      address: string;
      chain_type: string;
      wallet_id: number;
      wallet_type: string;
      wallet_label: string | null;
      wallet_profile: string;
    }>;

    // Build addressId -> wallet info map
    const addressToWallet = new Map<number, (typeof otherAddressRows)[number]>();
    for (const row of otherAddressRows) {
      addressToWallet.set(row.address_id, row);
    }

    // Group connections by connected wallet
    const walletConnMap = new Map<
      number,
      {
        wallet_id: number;
        wallet_type: string;
        wallet_label: string | null;
        wallet_profile: string;
        directCount: number;
        indirectCount: number;
        addresses: Set<string>;
      }
    >();

    for (const c of connections) {
      const otherId = myIdSet.has(c.address_id_1) ? c.address_id_2 : c.address_id_1;
      const otherInfo = addressToWallet.get(otherId);
      if (!otherInfo) continue;

      if (!walletConnMap.has(otherInfo.wallet_id)) {
        walletConnMap.set(otherInfo.wallet_id, {
          wallet_id: otherInfo.wallet_id,
          wallet_type: otherInfo.wallet_type,
          wallet_label: otherInfo.wallet_label,
          wallet_profile: otherInfo.wallet_profile,
          directCount: 0,
          indirectCount: 0,
          addresses: new Set(),
        });
      }

      const entry = walletConnMap.get(otherInfo.wallet_id)!;
      if (c.connection_type === "direct") entry.directCount++;
      else entry.indirectCount++;
      entry.addresses.add(otherInfo.address);
    }

    const connectedWallets = [...walletConnMap.values()]
      .map((w) => ({
        wallet_id: w.wallet_id,
        wallet_type: w.wallet_type,
        wallet_label: w.wallet_label,
        wallet_profile: w.wallet_profile,
        directCount: w.directCount,
        indirectCount: w.indirectCount,
        connectedAddresses: [...w.addresses],
      }))
      .sort((a, b) => (b.directCount + b.indirectCount) - (a.directCount + a.indirectCount));

    return Response.json({ connectedWallets });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ error: msg }, { status: 500 });
  }
}
