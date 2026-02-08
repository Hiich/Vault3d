---
description: Use Bun instead of Node.js, npm, pnpm, or vite.
globs: "*.ts, *.tsx, *.html, *.css, *.js, *.jsx, package.json"
alwaysApply: false
---

# Wallet Extract

A local-only tool for extracting and managing browser extension wallets (MetaMask + Phantom) from Brave browser profiles. Includes a web UI for extraction, browsing, balance tracking, and sending transactions.

## How to Run

```sh
bun --hot server.ts
```

Opens at `http://127.0.0.1:3000` (localhost only, never exposed to network).

## Architecture

### Runtime & Tooling

- **Runtime**: Bun (not Node.js) for everything: server, bundling, SQLite, tests
- **Server**: `Bun.serve()` with HTML imports (no Express, no Vite)
- **Database**: `bun:sqlite` (no better-sqlite3) — WAL mode, foreign keys enabled
- **Frontend**: React 19 via Bun HTML imports, Tailwind CSS via CDN `<script>` tag
- **Routing**: Hash-based client-side router (hand-rolled in `web/app.tsx`, ~35 lines)
- **Env**: Bun auto-loads `.env` — no dotenv needed

### Bun Conventions

- `bun <file>` instead of `node` / `ts-node`
- `bun test` instead of jest / vitest
- `bun install` instead of npm / yarn / pnpm
- `bunx <pkg>` instead of npx
- `Bun.file()` over `node:fs` readFile/writeFile
- `Bun.$\`cmd\`` instead of execa

## Project Structure

```
wallet-extract/
├── server.ts                       # Entry point — Bun.serve() on port 3000
├── server/
│   ├── db.ts                       # SQLite schema + CRUD helpers (singleton)
│   ├── routes/
│   │   ├── extraction.ts           # GET /api/profiles, POST /api/extract, POST /api/extract/profile
│   │   ├── wallets.ts              # CRUD /api/wallets, /api/wallets/:id, /api/wallets/:id/sensitive
│   │   ├── addresses.ts            # GET /api/addresses (filtered/sorted/paginated)
│   │   ├── balances.ts             # POST /api/balances/refresh, GET /api/balances/summary
│   │   ├── transactions.ts         # POST /api/tx/estimate, POST /api/tx/send, GET /api/tx
│   │   └── connections.ts          # POST /api/connections/scan, GET /api/connections/*
│   └── services/
│       ├── extraction.ts           # Reuses src/* modules, writes to DB
│       ├── balance-fetcher.ts      # Reads DB addresses, calls src/balances.ts, upserts results
│       ├── evm-tx.ts               # viem walletClient for EVM sends (native + ERC-20)
│       ├── solana-tx.ts            # @solana/web3.js for SOL/SPL sends
│       ├── transfer-fetcher.ts     # Alchemy + Helius transfer history fetching
│       └── connection-detector.ts  # Connection detection, Union-Find clustering
├── web/
│   ├── index.html                  # HTML entry (React + Tailwind + D3.js CDN)
│   ├── app.tsx                     # React root + hash router
│   ├── pages/
│   │   ├── Dashboard.tsx           # Balance summary cards, non-zero balances table
│   │   ├── Extract.tsx             # Profile discovery, password form, per-profile retry
│   │   ├── Wallets.tsx             # Wallet card grid with labels, delete, counts
│   │   ├── WalletDetail.tsx        # Mnemonic/key reveal, addresses, per-address balances
│   │   ├── Addresses.tsx           # Filterable/sortable address table with send button
│   │   ├── Transactions.tsx        # Tx history with explorer links, status badges
│   │   └── Connections.tsx         # Wallet connections & clusters, card view + D3 graph
│   ├── components/
│   │   ├── Layout.tsx              # Sidebar + content shell
│   │   ├── SendModal.tsx           # Send token modal (EVM + Solana)
│   │   └── FilterBar.tsx           # Chain/token/balance/wallet filters
│   └── lib/
│       ├── api.ts                  # Typed fetch wrappers + TypeScript interfaces
│       └── format.ts               # Address truncation, balance formatting, timeAgo
├── src/                            # Original CLI extraction modules (mostly untouched)
│   ├── index.ts                    # Original CLI entry point
│   ├── config.ts                   # discoverProfiles(), getExtensionDataPath(), EXTENSION_IDS
│   ├── leveldb-reader.ts           # readAllEntries() — copies LevelDB to temp dir to avoid locks
│   ├── metamask.ts                 # findVault(), decryptVault(), extractKeys()
│   ├── phantom.ts                  # findVault(), decryptVault(), extractKeys()
│   ├── evm.ts                      # deriveAddressesFromMnemonic(), deriveAddressFromPrivateKey()
│   ├── balances.ts                 # CHAINS, fetchEvmBalancesMulticall(), fetchSolanaBalancesBatch()
│   ├── balance-cli.ts              # CLI balance checking
│   └── types.ts                    # ChainConfig, AddressBalance
└── data/                           # gitignored — SQLite DB stored here
    └── wallet-extract.db
```

## Database Schema

Seven tables in `data/wallet-extract.db` (SQLite, WAL mode, `0o600` permissions):

- **wallets** — `id, type, profile, mnemonic, private_key, label, extracted_at, created_at`
  - Types: `metamask_hd`, `metamask_imported`, `phantom_seed`, `phantom_keypair`
- **addresses** — `id, wallet_id (FK), address, chain_type, derivation_index, created_at`
  - UNIQUE on `(address, chain_type)`
  - chain_type: `evm` or `solana`
- **balances** — `id, address_id (FK), chain, token, balance, balance_raw, updated_at`
  - UNIQUE on `(address_id, chain, token)`, upserted on refresh
- **transactions** — `id, address_id (FK), chain, token, to_address, amount, amount_raw, tx_hash, status, error, created_at`
  - Status: `pending` -> `submitted` -> `confirmed` | `failed`
- **transfers** — `id, from_address, to_address, chain, token, amount, tx_hash, block_number, timestamp, created_at`
  - UNIQUE on `(tx_hash, from_address, to_address, token)` — raw transfer history cache
  - Indexed on `from_address` and `to_address`
- **connections** — `id, address_id_1 (FK), address_id_2 (FK), connection_type, evidence, created_at`
  - UNIQUE on `(address_id_1, address_id_2, connection_type, evidence)`
  - connection_type: `direct` (A sent to B) or `indirect` (shared counterparty)
  - evidence: JSON blob with transfer details or shared external address
  - Canonical order: smaller address_id always stored as `address_id_1`
- **scan_state** — `id, address_id (FK), chain, last_block, last_scanned_at`
  - UNIQUE on `(address_id, chain)` — tracks incremental scan progress

All foreign keys cascade on delete. Indexes on `wallet_id`, `address_id`, `from_address`, `to_address`.

## API Routes

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/profiles` | List discovered Brave browser profiles |
| `POST` | `/api/extract` | Extract all profiles. Body: `{ metamaskPassword?, phantomPassword? }` |
| `POST` | `/api/extract/profile` | Extract single profile. Body: `{ profile, metamaskPassword?, phantomPassword? }` |
| `GET` | `/api/wallets` | List wallets with address counts |
| `GET` | `/api/wallets/:id` | Wallet detail with nested addresses + balances |
| `GET` | `/api/wallets/:id/sensitive` | Returns mnemonic / private_key (click-to-reveal in UI) |
| `DELETE` | `/api/wallets/:id` | Delete wallet (cascades) |
| `PATCH` | `/api/wallets/:id` | Update label. Body: `{ label }` |
| `GET` | `/api/addresses` | Filtered/sorted/paginated. Query: `chain_type, chain, token, min_balance, wallet_id, sort, page, limit` |
| `POST` | `/api/balances/refresh` | Re-fetch balances. Body: `{ addressIds?: number[] }` |
| `GET` | `/api/balances/summary` | Aggregated totals by chain + token |
| `POST` | `/api/tx/estimate` | Fee estimate. Body: `{ fromAddressId, toAddress, chain, token, amount }` |
| `POST` | `/api/tx/send` | Sign + broadcast. Same body. Returns `{ txHash, txId }` |
| `GET` | `/api/tx` | Transaction history. Query: `status, chain` |
| `POST` | `/api/connections/scan` | Trigger full transfer scan + connection detection + clustering |
| `GET` | `/api/connections/scan-state` | Scan progress: addresses scanned, transfers found, last scan time |
| `GET` | `/api/connections/clusters` | Computed clusters with member addresses and connections |
| `GET` | `/api/connections` | Paginated connection list. Query: `type` (direct/indirect), `page`, `limit` |

## API Response Shapes (Important for Frontend)

These shapes matter — mismatches between frontend types and backend responses caused bugs:

- **`GET /api/addresses`** returns **flat** balance columns (`balance_chain`, `balance_token`, `balance`, `balance_raw`, `balance_updated_at`) from a SQL LEFT JOIN. The `AddressRow` type in `api.ts` uses optional flat fields, NOT a nested `balances[]` array.
- **`GET /api/wallets/:id`** returns **nested** `addresses[].balances[]` arrays. The `WalletDetail` type uses `AddressWithBalances` which has `balances: BalanceEntry[]`.
- **`GET /api/balances/summary`** returns `total_balance` (not `total`). The SQL alias is `SUM(b.balance) AS total_balance`.
- **Pagination** is returned as `{ addresses, pagination: { page, limit, total, totalPages } }`, not `{ addresses, total }`.

## Dependencies

```json
{
  "react": "^19",
  "react-dom": "^19",
  "viem": "^2.45",
  "@solana/web3.js": "^1.98",
  "@solana/spl-token": "^0.4",
  "classic-level": "^3",
  "tweetnacl": "^1",
  "bs58": "^6",
  "bip39": "^3",
  "fs-extra": "^11"
}
```

## Supported Chains & Tokens

### EVM (via viem + Multicall3)
- **Ethereum** — ETH, USDC, USDT
- **Base** — ETH, USDC, USDT
- **Polygon** — POL, USDC, USDT
- **Abstract** (chain ID 2741) — ETH, USDC.e, USDT (custom `defineChain`)

### Solana (via @solana/web3.js)
- **Solana** — SOL, USDC (SPL token)

## Wallet Extraction Flow

1. `discoverProfiles()` scans Brave's `Application Support` directory
2. For each profile, reads extension LevelDB data (copies to temp dir to avoid browser locks)
3. **MetaMask**: AES-256-GCM decryption of vault blob -> HD keyrings + imported keys
4. **Phantom**: Two-stage NaCl secretbox decryption (password -> master key -> vault entries)
   - Keys use **base58** encoding (not base64) for salt, nonce, encrypted fields
   - Seed entropy is `{ "0": byte, "1": byte, ... }` dict, converted via `bip39.entropyToMnemonic()`
   - PrivateKey is `{ privateKey: { data: [byte, ...] } }`, 64-byte Ed25519 keypair
5. EVM addresses derived from mnemonics via `viem` HD wallet derivation
6. Everything persisted to SQLite

## Transaction Signing

### EVM
- Account reconstruction: `mnemonicToAccount(mnemonic, { addressIndex })` or `privateKeyToAccount(key)` from viem
- Native sends: `walletClient.sendTransaction({ to, value: parseEther(amount) })`
- ERC-20 sends: `walletClient.writeContract({ abi: erc20TransferAbi, ... })`

### Solana
- Keypair reconstruction: `Keypair.fromSecretKey(bs58.decode(secretKey))`
- Native SOL: `SystemProgram.transfer` instruction
- SPL USDC: `createTransferInstruction` from `@solana/spl-token`, auto-creates recipient ATA if needed

## Wallet Connections & Clusters

Discovers links between extracted wallets by analyzing on-chain transfer history.

### Transfer Fetching
- **EVM** (ethereum, base, polygon — not abstract, no Alchemy support): Uses `alchemy_getAssetTransfers` API. Two calls per address per chain (from + to). Paginates via `pageKey`. Categories: `["external", "erc20"]`. 150ms delay between calls, exponential backoff on 429.
- **Solana**: Uses Helius Enhanced Transactions API (`/v0/addresses/{address}/transactions`). Extracts `nativeTransfers` and `tokenTransfers`. Paginates with `before` parameter. 200ms delay between calls.
- **Incremental scanning**: `scan_state` table tracks `last_block` per address/chain. Re-scans only fetch new blocks.
- RPC URLs and API keys are extracted from existing `CHAINS` config in `src/balances.ts`.

### Connection Detection
- **Direct**: Both `from_address` and `to_address` in a transfer map to extracted addresses (one transfer = one direct connection per pair).
- **Indirect**: An external address transacted with 2+ extracted addresses (shared counterparty). Creates pairwise indirect connections.
- Connections store JSON `evidence` blobs — either `{ type: "direct_transfer", chain, token, tx_hash }` or `{ type: "shared_counterparty", external_address }`.
- All connections are cleared and recomputed on each scan (idempotent).

### Clustering (Union-Find)
- Connected addresses are grouped into clusters using a Union-Find data structure.
- Each cluster includes full address details (address, chain_type, wallet info) and associated connections.
- Clusters sorted by size descending.

### UI (`web/pages/Connections.tsx`)
- **Card view** (default): Cluster cards showing member addresses with chain/wallet badges, connection counts, expandable evidence details.
- **Graph view**: D3.js force-directed graph. Nodes colored by wallet_id, solid edges for direct connections, dashed for indirect. Drag to reposition, scroll to zoom, click node to navigate to wallet detail.
- D3.js v7 loaded via CDN (`web/index.html`), matching existing Tailwind CDN pattern.

## Key Design Decisions

1. **Hash-based routing** over a router library — keeps the bundle small, ~35 lines of code
2. **No build step for CSS** — Tailwind via CDN `<script>` tag (local tool, simplicity wins)
3. **`src/` modules untouched** except adding `export` to 3 items in `balances.ts` (`CHAINS`, `fetchEvmBalancesMulticall`, `fetchSolanaBalancesBatch`)
4. **Server binds to `127.0.0.1` only** — no network exposure
5. **DB file at `0o600`** — owner-only read/write
6. **Sensitive data behind separate endpoint** — `/api/wallets/:id/sensitive` with click-to-reveal UI
7. **Passwords never stored** — used only during extraction, then discarded
8. **Per-profile password retry** — when extraction fails with wrong password, the UI shows per-profile password inputs with retry buttons (not just a global password)
9. **`INSERT OR IGNORE` for addresses** — handles re-extraction without duplicates (UNIQUE constraint on `address, chain_type`)
10. **Flat vs nested balance data** — `/api/addresses` uses flat SQL JOIN columns for filtering efficiency; `/api/wallets/:id` uses nested arrays for display convenience
11. **D3.js via CDN** — same pattern as Tailwind, no npm dependency for visualization
12. **Canonical connection ordering** — `insertConnection()` always stores the smaller `address_id` as `address_id_1` to prevent duplicate pairs
13. **Idempotent connection detection** — connections are cleared and recomputed on each scan; transfers use `INSERT OR IGNORE` for deduplication
14. **Transfer history separate from transactions** — `transfers` table caches external API data (Alchemy/Helius); `transactions` table tracks user-initiated sends

## TypeScript Conventions

- `verbatimModuleSyntax: true` — must use `import type` for type-only imports
- `jsx: "react-jsx"` — no need to `import React` in JSX files (React 19 transform)
- `noUncheckedIndexedAccess: true` — array indexing returns `T | undefined`
- `allowImportingTsExtensions: true` — imports use `.ts` / `.tsx` extensions

## Bugs Fixed During Development

1. **Addresses page crash** (`Cannot read properties of undefined (reading 'length')`) — frontend expected `{ addresses, total }` but backend returns `{ addresses, pagination: { ... } }`. Also expected nested `balances[]` array but backend returns flat SQL columns.
2. **Dashboard `total` vs `total_balance`** — SQL alias mismatch between backend and frontend type.
3. **WalletDetail `address_count` undefined** — detail endpoint doesn't include `address_count`, fixed with `wallet.addresses?.length ?? wallet.address_count`.
4. **Wrong password handling** — added `POST /api/extract/profile` endpoint and per-profile retry UI so each profile can have its own password.

## Bun API Reference

- `Bun.serve()` supports WebSockets, HTTPS, and routes. Don't use `express`.
- `bun:sqlite` for SQLite. Don't use `better-sqlite3`.
- `Bun.redis` for Redis. Don't use `ioredis`.
- `Bun.sql` for Postgres. Don't use `pg` or `postgres.js`.
- `WebSocket` is built-in. Don't use `ws`.
- Prefer `Bun.file` over `node:fs`'s readFile/writeFile.
- `Bun.$\`ls\`` instead of execa.

For more information, read the Bun API docs in `node_modules/bun-types/docs/**.mdx`.
