import "./server/config.ts"; // Side-effect: sets process.env from data/config.json before other modules load
import index from "./web/index.html";
import { getDiscovery, postExtract, postExtractProfile } from "./server/routes/extraction.ts";
import { listWallets, getWalletById, getWalletSensitiveById, deleteWalletById, patchWalletById, getWalletConnections } from "./server/routes/wallets.ts";
import { listAddresses, getAddressById } from "./server/routes/addresses.ts";
import { postRefresh, getSummary } from "./server/routes/balances.ts";
import { postEstimate, postSend, postBulkSend, listTransactions } from "./server/routes/transactions.ts";
import { postScan, getScanStateSummary, getClusters, listConnections } from "./server/routes/connections.ts";
import { getSettings, postSettings } from "./server/routes/settings.ts";
import { listCustomTokens, addCustomToken, removeCustomToken, getAllTokens } from "./server/routes/tokens.ts";

const PORT = 3000;
const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
let lastActivity = Date.now();

// Auto-shutdown after 30 minutes of inactivity
setInterval(() => {
  if (Date.now() - lastActivity > IDLE_TIMEOUT_MS) {
    console.log("No activity for 30 minutes — shutting down.");
    process.exit(0);
  }
}, 60_000);

Bun.serve({
  port: PORT,
  hostname: "127.0.0.1",

  routes: {
    "/": index,
  },

  async fetch(req) {
    lastActivity = Date.now();
    const url = new URL(req.url);
    const path = url.pathname;
    const method = req.method;

    // --- API Routes ---

    // Extraction
    if (path === "/api/discover" && method === "GET") return getDiscovery(req);
    if (path === "/api/extract" && method === "POST") return postExtract(req);
    if (path === "/api/extract/profile" && method === "POST") return postExtractProfile(req);

    // Wallets
    if (path === "/api/wallets" && method === "GET") return listWallets(req);

    const walletConnectionsMatch = path.match(/^\/api\/wallets\/(\d+)\/connections$/);
    if (walletConnectionsMatch && method === "GET") {
      return getWalletConnections(req, parseInt(walletConnectionsMatch[1]!, 10));
    }

    const walletSensitiveMatch = path.match(/^\/api\/wallets\/(\d+)\/sensitive$/);
    if (walletSensitiveMatch && method === "GET") {
      return getWalletSensitiveById(req, parseInt(walletSensitiveMatch[1]!, 10));
    }

    const walletIdMatch = path.match(/^\/api\/wallets\/(\d+)$/);
    if (walletIdMatch) {
      const id = parseInt(walletIdMatch[1]!, 10);
      if (method === "GET") return getWalletById(req, id);
      if (method === "DELETE") return deleteWalletById(req, id);
      if (method === "PATCH") return patchWalletById(req, id);
    }

    // Addresses
    const addressIdMatch = path.match(/^\/api\/addresses\/(\d+)$/);
    if (addressIdMatch && method === "GET") return getAddressById(req, parseInt(addressIdMatch[1]!, 10));
    if (path === "/api/addresses" && method === "GET") return listAddresses(req);

    // Balances
    if (path === "/api/balances/refresh" && method === "POST") return postRefresh(req);
    if (path === "/api/balances/summary" && method === "GET") return getSummary(req);

    // Transactions
    if (path === "/api/tx/estimate" && method === "POST") return postEstimate(req);
    if (path === "/api/tx/send" && method === "POST") return postSend(req);
    if (path === "/api/tx/bulk-send" && method === "POST") return postBulkSend(req);
    if (path === "/api/tx" && method === "GET") return listTransactions(req);

    // Connections (more specific paths first)
    if (path === "/api/connections/scan" && method === "POST") return postScan(req);
    if (path === "/api/connections/scan-state" && method === "GET") return getScanStateSummary(req);
    if (path === "/api/connections/clusters" && method === "GET") return getClusters(req);
    if (path === "/api/connections" && method === "GET") return listConnections(req);

    // Settings
    if (path === "/api/settings" && method === "GET") return getSettings(req);
    if (path === "/api/settings" && method === "POST") return postSettings(req);

    // Custom Tokens
    if (path === "/api/tokens/all" && method === "GET") return getAllTokens(req);
    if (path === "/api/tokens" && method === "GET") return listCustomTokens(req);
    if (path === "/api/tokens" && method === "POST") return addCustomToken(req);
    const tokenIdMatch = path.match(/^\/api\/tokens\/(\d+)$/);
    if (tokenIdMatch && method === "DELETE") return removeCustomToken(req, parseInt(tokenIdMatch[1]!, 10));

    // 404
    return Response.json({ error: "Not found" }, { status: 404 });
  },
});

console.log(`Wallet Extract running at http://127.0.0.1:${PORT}`);
