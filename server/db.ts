import { Database } from "bun:sqlite";
import fs from "fs-extra";
import path from "path";

const DB_PATH = path.join(import.meta.dir, "..", "data", "wallet-extract.db");

let db: Database | null = null;

export function getDb(): Database {
  if (db) return db;

  fs.ensureDirSync(path.dirname(DB_PATH));
  db = new Database(DB_PATH, { create: true });
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");

  // Set file permissions to owner-only
  try {
    fs.chmodSync(DB_PATH, 0o600);
  } catch {}

  initSchema(db);
  return db;
}

function runMigrations(db: Database) {
  // Check if browser column exists
  const cols = db.prepare("PRAGMA table_info(wallets)").all() as { name: string }[];
  const hasBrowser = cols.some((c) => c.name === "browser");
  if (!hasBrowser) {
    db.exec(`ALTER TABLE wallets ADD COLUMN browser TEXT`);
    db.exec(`UPDATE wallets SET browser = 'Brave' WHERE browser IS NULL`);
    // Prefix profile values with browser name for existing records
    db.exec(`UPDATE wallets SET profile = 'Brave/' || profile WHERE profile NOT LIKE '%/%'`);
  }
}

function initSchema(db: Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS wallets (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      type         TEXT NOT NULL,
      profile      TEXT NOT NULL,
      mnemonic     TEXT,
      private_key  TEXT,
      label        TEXT,
      extracted_at TEXT NOT NULL DEFAULT (datetime('now')),
      created_at   TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS addresses (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      wallet_id        INTEGER NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
      address          TEXT NOT NULL,
      chain_type       TEXT NOT NULL,
      derivation_index INTEGER,
      created_at       TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(address, chain_type)
    );

    CREATE TABLE IF NOT EXISTS balances (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      address_id  INTEGER NOT NULL REFERENCES addresses(id) ON DELETE CASCADE,
      chain       TEXT NOT NULL,
      token       TEXT NOT NULL,
      balance     TEXT NOT NULL DEFAULT '0.00',
      balance_raw TEXT NOT NULL DEFAULT '0x0',
      updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(address_id, chain, token)
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      address_id  INTEGER NOT NULL REFERENCES addresses(id) ON DELETE CASCADE,
      chain       TEXT NOT NULL,
      token       TEXT NOT NULL,
      to_address  TEXT NOT NULL,
      amount      TEXT NOT NULL,
      amount_raw  TEXT NOT NULL,
      tx_hash     TEXT,
      status      TEXT NOT NULL DEFAULT 'pending',
      error       TEXT,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_addresses_wallet ON addresses(wallet_id);
    CREATE INDEX IF NOT EXISTS idx_balances_address ON balances(address_id);
    CREATE INDEX IF NOT EXISTS idx_transactions_address ON transactions(address_id);

    CREATE TABLE IF NOT EXISTS transfers (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      from_address TEXT NOT NULL,
      to_address   TEXT NOT NULL,
      chain        TEXT NOT NULL,
      token        TEXT NOT NULL,
      amount       TEXT NOT NULL DEFAULT '0',
      tx_hash      TEXT NOT NULL,
      block_number INTEGER,
      timestamp    TEXT,
      created_at   TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(tx_hash, from_address, to_address, token)
    );
    CREATE INDEX IF NOT EXISTS idx_transfers_from ON transfers(from_address);
    CREATE INDEX IF NOT EXISTS idx_transfers_to ON transfers(to_address);

    CREATE TABLE IF NOT EXISTS connections (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      address_id_1    INTEGER NOT NULL REFERENCES addresses(id) ON DELETE CASCADE,
      address_id_2    INTEGER NOT NULL REFERENCES addresses(id) ON DELETE CASCADE,
      connection_type TEXT NOT NULL,
      evidence        TEXT NOT NULL,
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(address_id_1, address_id_2, connection_type, evidence)
    );

    CREATE TABLE IF NOT EXISTS scan_state (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      address_id      INTEGER NOT NULL REFERENCES addresses(id) ON DELETE CASCADE,
      chain           TEXT NOT NULL,
      last_block      INTEGER DEFAULT 0,
      last_scanned_at TEXT,
      UNIQUE(address_id, chain)
    );

    CREATE TABLE IF NOT EXISTS custom_tokens (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      chain      TEXT NOT NULL,
      name       TEXT NOT NULL,
      contract   TEXT NOT NULL,
      decimals   INTEGER NOT NULL,
      type       TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(chain, contract)
    );
  `);

  // --- Migration: add browser column ---
  runMigrations(db);
}

// --- Wallet helpers ---

export function insertWallet(data: {
  type: string;
  profile: string;
  browser?: string | null;
  mnemonic?: string | null;
  private_key?: string | null;
  label?: string | null;
}): number {
  const stmt = getDb().prepare(
    `INSERT INTO wallets (type, profile, browser, mnemonic, private_key, label)
     VALUES ($type, $profile, $browser, $mnemonic, $private_key, $label)`
  );
  const result = stmt.run({
    $type: data.type,
    $profile: data.profile,
    $browser: data.browser ?? null,
    $mnemonic: data.mnemonic ?? null,
    $private_key: data.private_key ?? null,
    $label: data.label ?? null,
  });
  return Number(result.lastInsertRowid);
}

export function insertAddress(data: {
  wallet_id: number;
  address: string;
  chain_type: string;
  derivation_index?: number | null;
}): number {
  const stmt = getDb().prepare(
    `INSERT OR IGNORE INTO addresses (wallet_id, address, chain_type, derivation_index)
     VALUES ($wallet_id, $address, $chain_type, $derivation_index)`
  );
  const result = stmt.run({
    $wallet_id: data.wallet_id,
    $address: data.address,
    $chain_type: data.chain_type,
    $derivation_index: data.derivation_index ?? null,
  });
  if (Number(result.lastInsertRowid) === 0) {
    // Already existed, fetch the existing id
    const existing = getDb()
      .prepare(`SELECT id FROM addresses WHERE address = $address AND chain_type = $chain_type`)
      .get({ $address: data.address, $chain_type: data.chain_type }) as { id: number } | null;
    return existing?.id ?? 0;
  }
  return Number(result.lastInsertRowid);
}

export function upsertBalance(data: {
  address_id: number;
  chain: string;
  token: string;
  balance: string;
  balance_raw: string;
}): void {
  getDb()
    .prepare(
      `INSERT INTO balances (address_id, chain, token, balance, balance_raw, updated_at)
       VALUES ($address_id, $chain, $token, $balance, $balance_raw, datetime('now'))
       ON CONFLICT(address_id, chain, token)
       DO UPDATE SET balance = $balance, balance_raw = $balance_raw, updated_at = datetime('now')`
    )
    .run({
      $address_id: data.address_id,
      $chain: data.chain,
      $token: data.token,
      $balance: data.balance,
      $balance_raw: data.balance_raw,
    });
}

export function insertTransaction(data: {
  address_id: number;
  chain: string;
  token: string;
  to_address: string;
  amount: string;
  amount_raw: string;
  tx_hash?: string | null;
  status?: string;
  error?: string | null;
}): number {
  const stmt = getDb().prepare(
    `INSERT INTO transactions (address_id, chain, token, to_address, amount, amount_raw, tx_hash, status, error)
     VALUES ($address_id, $chain, $token, $to_address, $amount, $amount_raw, $tx_hash, $status, $error)`
  );
  const result = stmt.run({
    $address_id: data.address_id,
    $chain: data.chain,
    $token: data.token,
    $to_address: data.to_address,
    $amount: data.amount,
    $amount_raw: data.amount_raw,
    $tx_hash: data.tx_hash ?? null,
    $status: data.status ?? "pending",
    $error: data.error ?? null,
  });
  return Number(result.lastInsertRowid);
}

export function updateTransactionStatus(
  id: number,
  status: string,
  txHash?: string | null,
  error?: string | null
): void {
  getDb()
    .prepare(
      `UPDATE transactions SET status = $status, tx_hash = COALESCE($tx_hash, tx_hash), error = $error WHERE id = $id`
    )
    .run({ $id: id, $status: status, $tx_hash: txHash ?? null, $error: error ?? null });
}

// --- Transfer helpers ---

export function insertTransfer(data: {
  from_address: string;
  to_address: string;
  chain: string;
  token: string;
  amount: string;
  tx_hash: string;
  block_number?: number | null;
  timestamp?: string | null;
}): void {
  getDb()
    .prepare(
      `INSERT OR IGNORE INTO transfers (from_address, to_address, chain, token, amount, tx_hash, block_number, timestamp)
       VALUES ($from_address, $to_address, $chain, $token, $amount, $tx_hash, $block_number, $timestamp)`
    )
    .run({
      $from_address: data.from_address,
      $to_address: data.to_address,
      $chain: data.chain,
      $token: data.token,
      $amount: data.amount,
      $tx_hash: data.tx_hash,
      $block_number: data.block_number ?? null,
      $timestamp: data.timestamp ?? null,
    });
}

// --- Connection helpers ---

export function insertConnection(data: {
  address_id_1: number;
  address_id_2: number;
  connection_type: string;
  evidence: string;
}): void {
  // Canonical order: smaller id first
  const id1 = Math.min(data.address_id_1, data.address_id_2);
  const id2 = Math.max(data.address_id_1, data.address_id_2);
  getDb()
    .prepare(
      `INSERT OR IGNORE INTO connections (address_id_1, address_id_2, connection_type, evidence)
       VALUES ($id1, $id2, $connection_type, $evidence)`
    )
    .run({
      $id1: id1,
      $id2: id2,
      $connection_type: data.connection_type,
      $evidence: data.evidence,
    });
}

export function clearConnections(): void {
  getDb().prepare(`DELETE FROM connections`).run();
}

// --- Scan state helpers ---

export function upsertScanState(data: {
  address_id: number;
  chain: string;
  last_block: number;
}): void {
  getDb()
    .prepare(
      `INSERT INTO scan_state (address_id, chain, last_block, last_scanned_at)
       VALUES ($address_id, $chain, $last_block, datetime('now'))
       ON CONFLICT(address_id, chain)
       DO UPDATE SET last_block = $last_block, last_scanned_at = datetime('now')`
    )
    .run({
      $address_id: data.address_id,
      $chain: data.chain,
      $last_block: data.last_block,
    });
}

export function getScanState(
  addressId: number,
  chain: string
): { last_block: number; last_scanned_at: string | null } | null {
  return getDb()
    .prepare(`SELECT last_block, last_scanned_at FROM scan_state WHERE address_id = $address_id AND chain = $chain`)
    .get({ $address_id: addressId, $chain: chain }) as {
    last_block: number;
    last_scanned_at: string | null;
  } | null;
}

// --- Custom token helpers ---

export interface CustomTokenRow {
  id: number;
  chain: string;
  name: string;
  contract: string;
  decimals: number;
  type: string;
  created_at: string;
}

export function insertCustomToken(data: {
  chain: string;
  name: string;
  contract: string;
  decimals: number;
  type: string;
}): number {
  const stmt = getDb().prepare(
    `INSERT INTO custom_tokens (chain, name, contract, decimals, type)
     VALUES ($chain, $name, $contract, $decimals, $type)`
  );
  const result = stmt.run({
    $chain: data.chain,
    $name: data.name,
    $contract: data.contract,
    $decimals: data.decimals,
    $type: data.type,
  });
  return Number(result.lastInsertRowid);
}

export function getCustomTokens(): CustomTokenRow[] {
  return getDb()
    .prepare("SELECT * FROM custom_tokens ORDER BY chain, name")
    .all() as CustomTokenRow[];
}

export function deleteCustomToken(id: number): void {
  getDb().prepare("DELETE FROM custom_tokens WHERE id = $id").run({ $id: id });
}
