# Vault3d

Local-only tool for extracting and managing browser extension wallets (MetaMask + Phantom) from Brave browser profiles. Includes a web UI for extraction, browsing, balance tracking, and sending transactions.

Everything runs on `127.0.0.1` — nothing is exposed to the network. Passwords are used only during extraction and never stored. The server auto-shuts down after 30 minutes of inactivity.

## Quick Install

```sh
curl -fsSL https://raw.githubusercontent.com/Hiich/Vault3d/main/setup.sh | bash
```

This installs Bun (if needed), clones the repo, installs dependencies, creates a launchable app, and opens the browser. On macOS it creates a Spotlight-searchable app; on Linux it adds a `.desktop` entry.

## Run (dev)

```sh
bun --hot server.ts
```

Opens at http://127.0.0.1:3000.

## Relaunch

- **macOS**: Search "Vault3d" in Spotlight (Cmd+Space)
- **Linux**: Find "Vault3d" in your app menu
- **Terminal**: `~/Vault3d/launch.sh`

## Features

- **Wallet Extraction** — Reads MetaMask and Phantom extension data from Brave browser profiles via LevelDB. Supports per-profile passwords with retry.
- **Balance Tracking** — Fetches balances across Ethereum, Base, Polygon, Abstract (EVM) and Solana using Multicall3 and native RPC.
- **Send Transactions** — Sign and broadcast native + token transfers (ERC-20, SPL) directly from the UI. Fee estimation included.
- **Wallet Connections** — Discovers links between wallets by analyzing on-chain transfer history (Alchemy for EVM, Helius for Solana). Union-Find clustering with D3.js force-directed graph visualization.
- **Custom Tokens** — Track any ERC-20 or SPL token by adding its contract address in Settings.
- **Auto-shutdown** — Server exits after 30 minutes of inactivity so it doesn't sit in the background.

## Supported Chains

| Chain | Native | Tokens |
|-------|--------|--------|
| Ethereum | ETH | USDC, USDT |
| Base | ETH | USDC, USDT |
| Polygon | POL | USDC, USDT |
| Abstract | ETH | USDC.e, USDT |
| Solana | SOL | USDC |

Plus any custom ERC-20/SPL tokens you add.

## API Keys

Balance checking and connection scanning require free API keys. Configure them in the Settings page (links to sign up are provided there):

- **Alchemy** — EVM chains (Ethereum, Base, Polygon, Abstract)
- **Helius** — Solana balances and transfers

## Tech Stack

- **Runtime**: [Bun](https://bun.sh)
- **Frontend**: React 19 + Tailwind CSS (CDN) + D3.js
- **Database**: SQLite via `bun:sqlite` (WAL mode)
- **EVM**: viem
- **Solana**: @solana/web3.js + @solana/spl-token
- **Crypto**: tweetnacl (NaCl secretbox), bip39, classic-level (LevelDB)

## Security

- Server binds to `127.0.0.1` only
- Database file permissions: `0o600` (owner-only)
- Sensitive data (mnemonics, private keys) behind a separate API endpoint with click-to-reveal UI
- Passwords never stored — used only during extraction then discarded
- `data/` directory is gitignored
