# Vault3d

A local-only tool for extracting, managing, and analyzing browser extension wallets (MetaMask + Phantom) from Brave browser profiles. Features a web UI for vault decryption, multi-chain balance tracking, transaction sending, and wallet connection graph analysis.

> **Runs on `127.0.0.1` only.** Your keys never leave your machine.

## Features

- **Vault Extraction** — Decrypt MetaMask (AES-256-GCM) and Phantom (NaCl secretbox) vaults from Brave's LevelDB storage
- **Multi-Chain Balances** — Fetch balances across Ethereum, Base, Polygon, Abstract, and Solana via Multicall3 / JSON-RPC batching
- **Transaction Sending** — Sign and broadcast native + token transfers on EVM chains and Solana (including SPL)
- **Bulk Send** — Select multiple addresses and sweep funds in one batch operation
- **Connection Analysis** — Scan on-chain transfer history, detect direct/indirect links between your addresses, and visualize clusters with a D3.js force-directed graph
- **Address-Centric UI** — Flat address table with inline balances, filtering, sorting, and click-through to per-address detail with source key reveal

## Screenshots

```
Dashboard        — Aggregated balance cards across all chains
Addresses        — Filterable/sortable flat address table
Address Detail   — Per-address balances, send button, source key reveal
Connections      — Cluster cards + interactive D3 graph
```

## Quick Start

### Install (one command)

Open Terminal (press **Cmd + Space**, type **Terminal**, press **Enter**) and paste:

```bash
curl -fsSL https://raw.githubusercontent.com/Hiich/Vault3d/main/setup.sh | bash
```

That's it. The script installs everything automatically (Xcode tools, Bun, dependencies), downloads the app to `~/Vault3d`, starts the server, and opens your browser.

**Re-running** the command updates to the latest version and relaunches.

### Developer Setup

```bash
git clone https://github.com/Hiich/Vault3d.git
cd Vault3d
bun install
bun run start
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000).

### API Keys

API keys are configured through the web UI (Settings page) and stored in `data/config.json`. You can also use a `.env` file:

```env
ALCHEMY_API_KEY=your_alchemy_key
HELIUS_API_KEY=your_helius_key
```

- [Alchemy](https://dashboard.alchemy.com) — required for EVM chain balances, transactions, and connection scanning
- [Helius](https://dev.helius.xyz) — required for Solana balances, transactions, and connection scanning
- Wallet extraction works without any API keys

## How It Works

### Wallet Extraction Flow

1. **Profile Discovery** — Scans `~/Library/Application Support/BraveSoftware/Brave-Browser` for all profiles
2. **LevelDB Reading** — Copies extension data to a temp directory (avoids browser lock conflicts)
3. **MetaMask Decryption** — PBKDF2 key derivation + AES-256-GCM decryption of the vault blob. Extracts HD keyrings (mnemonic + derived addresses) and imported private keys
4. **Phantom Decryption** — Two-stage NaCl secretbox: password derives a key to unlock the master key, which then decrypts individual vault entries. Uses base58 encoding (not base64). Seed entropy is converted to a BIP39 mnemonic; keypairs are 64-byte Ed25519
5. **Address Derivation** — EVM addresses derived via BIP44 (`m/44'/60'/0'/0/{i}`) using viem. Solana keypairs are already extracted from Phantom
6. **Persistence** — Everything stored in SQLite with `INSERT OR IGNORE` to handle re-extraction cleanly

### Balance Fetching

| Chain | Method | Details |
|-------|--------|---------|
| Ethereum | Multicall3 | Single aggregate call for native ETH + USDC + USDT across all addresses |
| Base | Multicall3 | Same pattern — ETH + USDC + USDT |
| Polygon | Multicall3 | POL + USDC + USDT |
| Abstract | Multicall3 | ETH + USDC.e + USDT |
| Solana | JSON-RPC batch | `getBalance` + `getTokenAccountsByOwner` for SOL + USDC (SPL) |

### Transaction Signing

**EVM** — Reconstructs viem `Account` from mnemonic (`mnemonicToAccount`) or private key (`privateKeyToAccount`). Native sends use `walletClient.sendTransaction`, ERC-20 sends use `walletClient.writeContract` with the standard transfer ABI.

**Solana** — Reconstructs `Keypair` from base58-encoded secret key. Native SOL uses `SystemProgram.transfer`. SPL USDC uses `createTransferInstruction` from `@solana/spl-token`, auto-creating the recipient's Associated Token Account if needed.

### Connection Detection

1. **Transfer History Scanning** — Fetches on-chain transfers via Alchemy (`alchemy_getAssetTransfers`) for EVM chains and Helius Enhanced Transactions API for Solana. Incremental — tracks last scanned block per address/chain
2. **Direct Connections** — Both sender and receiver are extracted addresses
3. **Indirect Connections** — An external address transacted with 2+ of your extracted addresses (shared counterparty)
4. **Clustering** — Union-Find groups connected addresses into clusters, visualized as a D3.js force-directed graph

## Architecture

```
server.ts                         Bun.serve() entry point (127.0.0.1:3000)
├── setup.sh                      One-command installer
├── server/
│   ├── config.ts                 Config manager (reads data/config.json → process.env)
│   ├── db.ts                     SQLite schema + CRUD (bun:sqlite, WAL mode)
│   ├── routes/                   API route handlers
│   │   ├── extraction.ts         Profile discovery + vault extraction
│   │   ├── wallets.ts            Wallet CRUD + sensitive data endpoint
│   │   ├── addresses.ts          Address listing + detail
│   │   ├── balances.ts           Balance refresh + summary
│   │   ├── transactions.ts       Fee estimation + send + bulk send
│   │   ├── connections.ts        Scan trigger + clusters + connection list
│   │   └── settings.ts           API key configuration
│   └── services/                 Business logic
│       ├── extraction.ts         Orchestrates src/* modules → DB
│       ├── balance-fetcher.ts    Multicall3 / Solana RPC → DB upsert
│       ├── evm-tx.ts             viem walletClient for EVM sends
│       ├── solana-tx.ts          @solana/web3.js for SOL/SPL sends
│       ├── transfer-fetcher.ts   Alchemy + Helius history scanning
│       └── connection-detector.ts Union-Find clustering
├── src/                          Core extraction modules
│   ├── config.ts                 Profile discovery, extension paths
│   ├── leveldb-reader.ts         LevelDB → Map<key, value>
│   ├── metamask.ts               AES-256-GCM vault decryption
│   ├── phantom.ts                NaCl secretbox vault decryption
│   ├── evm.ts                    BIP44 address derivation (viem)
│   ├── balances.ts               Chain configs + balance fetching
│   └── types.ts                  Shared TypeScript types
├── web/                          React 19 frontend (Bun HTML imports)
│   ├── index.html                Entry — Tailwind + D3.js via CDN
│   ├── app.tsx                   Hash-based router (~35 lines)
│   ├── pages/                    Dashboard, Extract, Addresses, AddressDetail,
│   │                             Transactions, Connections, Settings, Setup
│   ├── components/               Layout, SendModal, BulkSendBar, FilterBar
│   └── lib/                      Typed API client + formatting utils
└── data/                         SQLite DB (gitignored, 0o600 permissions)
```

## Database

Seven tables in SQLite (WAL mode, foreign keys, cascading deletes):

| Table | Purpose |
|-------|---------|
| `wallets` | Extracted wallets — type, profile, mnemonic/key, label |
| `addresses` | Derived addresses — `UNIQUE(address, chain_type)` |
| `balances` | Per-address per-chain per-token balances — upserted on refresh |
| `transactions` | User-initiated sends — status: pending → confirmed/failed |
| `transfers` | On-chain transfer history cache (Alchemy/Helius data) |
| `connections` | Direct/indirect links between addresses with JSON evidence |
| `scan_state` | Incremental scan progress per address/chain |

## API

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/profiles` | List Brave browser profiles |
| `POST` | `/api/extract` | Extract all profiles |
| `POST` | `/api/extract/profile` | Extract single profile (per-profile password retry) |
| `GET` | `/api/wallets` | List wallets with address counts |
| `GET` | `/api/wallets/:id` | Wallet detail with nested addresses + balances |
| `GET` | `/api/wallets/:id/sensitive` | Mnemonic / private key (click-to-reveal) |
| `DELETE` | `/api/wallets/:id` | Delete wallet (cascades) |
| `PATCH` | `/api/wallets/:id` | Update label |
| `GET` | `/api/addresses` | Filtered/sorted/paginated address list |
| `GET` | `/api/addresses/:id` | Address detail with wallet metadata + balances |
| `POST` | `/api/balances/refresh` | Re-fetch balances (optionally scoped to address IDs) |
| `GET` | `/api/balances/summary` | Aggregated totals by chain + token |
| `POST` | `/api/tx/estimate` | Fee estimate for a transfer |
| `POST` | `/api/tx/send` | Sign + broadcast a transaction |
| `POST` | `/api/tx/bulk-send` | Batch send from multiple addresses |
| `GET` | `/api/tx` | Transaction history |
| `POST` | `/api/connections/scan` | Trigger transfer history scan + connection detection |
| `GET` | `/api/connections/scan-state` | Scan progress |
| `GET` | `/api/connections/clusters` | Computed address clusters |
| `GET` | `/api/connections` | Paginated connection list |
| `GET` | `/api/settings` | Config status (never returns actual keys) |
| `POST` | `/api/settings` | Save API keys + complete setup |

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | [Bun](https://bun.sh) |
| Server | `Bun.serve()` (no Express) |
| Database | `bun:sqlite` (no better-sqlite3) |
| Frontend | React 19 via Bun HTML imports |
| Styling | Tailwind CSS (CDN, no build step) |
| Graphs | D3.js v7 (CDN) |
| EVM | [viem](https://viem.sh) — Multicall3, account reconstruction, tx signing |
| Solana | [@solana/web3.js](https://solana-labs.github.io/solana-web3.js/) + @solana/spl-token |
| Crypto | tweetnacl (NaCl secretbox), Web Crypto API (AES-256-GCM, PBKDF2) |
| LevelDB | classic-level |
| BIP39 | bip39 (entropy → mnemonic) |
| Encoding | bs58 (base58 for Phantom vault fields) |

## Security

- **Localhost only** — Server binds to `127.0.0.1`, never `0.0.0.0`
- **DB permissions** — SQLite file created with `0o600` (owner-only read/write)
- **Passwords never stored** — Used only during extraction, then discarded
- **Sensitive data behind separate endpoint** — `/api/wallets/:id/sensitive` with click-to-reveal UI
- **No telemetry, no external calls** except RPC providers (Alchemy, Helius) for balance/transfer data
- **API keys in `.env` or `data/config.json`** — Never committed to the repository, config file created with `0o600` permissions

## Supported Wallets

| Wallet | Encryption | Key Types |
|--------|-----------|-----------|
| MetaMask | PBKDF2 + AES-256-GCM | HD keyrings (mnemonic), imported private keys |
| Phantom | PBKDF2/scrypt + NaCl secretbox (two-stage) | Seed phrases (BIP39), Ed25519 keypairs |

## Supported Chains

| Chain | Native Token | Tokens | Balance Method |
|-------|-------------|--------|---------------|
| Ethereum | ETH | USDC, USDT | Multicall3 |
| Base | ETH | USDC, USDT | Multicall3 |
| Polygon | POL | USDC, USDT | Multicall3 |
| Abstract | ETH | USDC.e, USDT | Multicall3 |
| Solana | SOL | USDC (SPL) | JSON-RPC batch |

## License

MIT
