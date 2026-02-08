import { useState, useEffect } from "react";
import { getConfigStatus, saveConfig } from "../lib/api.ts";
import type { ConfigStatus } from "../lib/api.ts";

export function Settings() {
  const [config, setConfig] = useState<ConfigStatus | null>(null);
  const [alchemyKey, setAlchemyKey] = useState("");
  const [heliusKey, setHeliusKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getConfigStatus().then(setConfig).catch(() => {});
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const body: Record<string, string | boolean> = {};
      if (alchemyKey) body.alchemy_api_key = alchemyKey;
      if (heliusKey) body.helius_api_key = heliusKey;
      await saveConfig(body);
      setSaved(true);
      setAlchemyKey("");
      setHeliusKey("");
      // Refresh status
      const updated = await getConfigStatus();
      setConfig(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  if (!config) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500 text-sm">Loading settings...</div>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-xl font-bold">Settings</h2>
        <p className="text-sm text-gray-500 mt-1">Manage API keys for balance checking and transactions</p>
      </div>

      <div className="max-w-xl space-y-6">
        {/* Alchemy */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="text-sm font-medium">Alchemy API Key</h3>
              <p className="text-xs text-gray-500 mt-0.5">Used for EVM chains (Ethereum, Base, Polygon, Abstract)</p>
            </div>
            <span
              className={`text-xs px-2 py-0.5 rounded-full ${
                config.hasAlchemyKey
                  ? "bg-green-500/20 text-green-400"
                  : "bg-yellow-500/20 text-yellow-400"
              }`}
            >
              {config.hasAlchemyKey ? "Configured" : "Not configured"}
            </span>
          </div>
          <input
            type="password"
            value={alchemyKey}
            onChange={(e) => setAlchemyKey(e.target.value)}
            placeholder={config.hasAlchemyKey ? "Enter new key to replace" : "Enter your Alchemy API key"}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-blue-500"
          />
          <a
            href="https://dashboard.alchemy.com/signup"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-blue-400 hover:text-blue-300 mt-1.5 inline-block"
          >
            Get a free key at alchemy.com
          </a>
        </div>

        {/* Helius */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="text-sm font-medium">Helius API Key</h3>
              <p className="text-xs text-gray-500 mt-0.5">Used for Solana balances and transfers</p>
            </div>
            <span
              className={`text-xs px-2 py-0.5 rounded-full ${
                config.hasHeliusKey
                  ? "bg-green-500/20 text-green-400"
                  : "bg-yellow-500/20 text-yellow-400"
              }`}
            >
              {config.hasHeliusKey ? "Configured" : "Not configured"}
            </span>
          </div>
          <input
            type="password"
            value={heliusKey}
            onChange={(e) => setHeliusKey(e.target.value)}
            placeholder={config.hasHeliusKey ? "Enter new key to replace" : "Enter your Helius API key"}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-blue-500"
          />
          <a
            href="https://dev.helius.xyz/dashboard/app"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-blue-400 hover:text-blue-300 mt-1.5 inline-block"
          >
            Get a free key at helius.dev
          </a>
        </div>

        {/* Save */}
        {error && (
          <div className="text-sm text-red-400 bg-red-400/10 rounded-lg px-3 py-2">
            {error}
          </div>
        )}

        {saved && (
          <div className="text-sm text-green-400 bg-green-400/10 rounded-lg px-3 py-2">
            Keys saved. Restart the server for changes to take effect:{" "}
            <code className="bg-gray-800 px-1.5 py-0.5 rounded text-xs">bun run start</code>
          </div>
        )}

        <button
          onClick={handleSave}
          disabled={saving || (!alchemyKey && !heliusKey)}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium rounded-lg transition-colors"
        >
          {saving ? "Saving..." : "Save Changes"}
        </button>
      </div>
    </div>
  );
}
