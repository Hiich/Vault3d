/**
 * Config module — side-effect import that sets process.env before other modules load.
 * Reads from data/config.json, falls back to process.env (so .env still works).
 *
 * Import this as the FIRST import in server.ts:
 *   import "./server/config.ts";
 */
import fs from "fs-extra";
import path from "path";

const CONFIG_PATH = path.join(import.meta.dir, "..", "data", "config.json");

interface AppConfig {
  alchemy_api_key: string;
  helius_api_key: string;
  setup_completed_at: string | null;
}

const DEFAULT_CONFIG: AppConfig = {
  alchemy_api_key: "",
  helius_api_key: "",
  setup_completed_at: null,
};

function loadConfig(): AppConfig {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const raw = fs.readFileSync(CONFIG_PATH, "utf-8");
      return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
    }
  } catch {
    // Config file corrupt or unreadable — use defaults
  }
  return { ...DEFAULT_CONFIG };
}

// --- Run on import: set process.env from config.json ---
const config = loadConfig();

// Config values override process.env only if they're non-empty.
// This means .env values are used as fallback (backwards compatible).
if (config.alchemy_api_key) {
  process.env.ALCHEMY_API_KEY = config.alchemy_api_key;
}
if (config.helius_api_key) {
  process.env.HELIUS_API_KEY = config.helius_api_key;
}

// --- Exported helpers ---

export function getConfig(): AppConfig {
  return loadConfig();
}

export function isConfigured(): boolean {
  const c = loadConfig();
  return !!(
    (c.alchemy_api_key || process.env.ALCHEMY_API_KEY) &&
    (c.helius_api_key || process.env.HELIUS_API_KEY)
  );
}

export function hasAlchemyKey(): boolean {
  return !!(loadConfig().alchemy_api_key || process.env.ALCHEMY_API_KEY);
}

export function hasHeliusKey(): boolean {
  return !!(loadConfig().helius_api_key || process.env.HELIUS_API_KEY);
}

export function updateConfig(
  updates: Partial<Pick<AppConfig, "alchemy_api_key" | "helius_api_key" | "setup_completed_at">>
): void {
  const current = loadConfig();
  const merged = { ...current, ...updates };

  fs.ensureDirSync(path.dirname(CONFIG_PATH));
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(merged, null, 2), "utf-8");

  try {
    fs.chmodSync(CONFIG_PATH, 0o600);
  } catch {}

  // Also update process.env so the current process picks up changes
  // (but module-level consts in balances.ts etc. won't update until restart)
  if (updates.alchemy_api_key !== undefined) {
    process.env.ALCHEMY_API_KEY = updates.alchemy_api_key;
  }
  if (updates.helius_api_key !== undefined) {
    process.env.HELIUS_API_KEY = updates.helius_api_key;
  }
}
