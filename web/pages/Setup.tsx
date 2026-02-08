import { useState } from "react";
import { saveConfig } from "../lib/api.ts";

interface SetupProps {
  onComplete: () => void;
}

export function Setup({ onComplete }: SetupProps) {
  const [alchemyKey, setAlchemyKey] = useState("");
  const [heliusKey, setHeliusKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      await saveConfig({
        alchemy_api_key: alchemyKey,
        helius_api_key: heliusKey,
        completeSetup: true,
      });
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const handleSkip = async () => {
    setSaving(true);
    try {
      await saveConfig({ completeSetup: true });
      onComplete();
    } catch {
      onComplete();
    }
  };

  if (saved) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="max-w-md w-full bg-gray-900 border border-gray-800 rounded-xl p-8 text-center">
          <div className="w-12 h-12 bg-green-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-6 h-6 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-lg font-bold mb-2">Keys Saved</h2>
          <p className="text-sm text-gray-400 mb-6">
            Restart the server for changes to take effect, then refresh this page.
          </p>
          <code className="block bg-gray-800 rounded-lg px-4 py-3 text-sm text-gray-300 mb-4">
            bun run start
          </code>
          <button
            onClick={onComplete}
            className="text-sm text-blue-400 hover:text-blue-300"
          >
            Continue without restart
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="max-w-lg w-full">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-blue-400 mb-2">Welcome to Vault3d</h1>
          <p className="text-sm text-gray-400">
            A local tool for extracting and managing browser extension wallets.
            Wallet extraction works without API keys. Balances, transactions, and
            connections require them.
          </p>
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 space-y-5">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">
              Alchemy API Key
              <span className="text-gray-500 font-normal ml-1">(EVM balances & transfers)</span>
            </label>
            <input
              type="password"
              value={alchemyKey}
              onChange={(e) => setAlchemyKey(e.target.value)}
              placeholder="Enter your Alchemy API key"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-blue-500"
            />
            <a
              href="https://dashboard.alchemy.com/signup"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-blue-400 hover:text-blue-300 mt-1 inline-block"
            >
              Get a free key at alchemy.com
            </a>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">
              Helius API Key
              <span className="text-gray-500 font-normal ml-1">(Solana balances & transfers)</span>
            </label>
            <input
              type="password"
              value={heliusKey}
              onChange={(e) => setHeliusKey(e.target.value)}
              placeholder="Enter your Helius API key"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-blue-500"
            />
            <a
              href="https://dev.helius.xyz/dashboard/app"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-blue-400 hover:text-blue-300 mt-1 inline-block"
            >
              Get a free key at helius.dev
            </a>
          </div>

          {error && (
            <div className="text-sm text-red-400 bg-red-400/10 rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          <div className="flex items-center justify-between pt-2">
            <button
              onClick={handleSkip}
              disabled={saving}
              className="text-sm text-gray-400 hover:text-gray-300"
            >
              Skip for now
            </button>
            <button
              onClick={handleSave}
              disabled={saving || (!alchemyKey && !heliusKey)}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium rounded-lg transition-colors"
            >
              {saving ? "Saving..." : "Save & Start"}
            </button>
          </div>
        </div>

        <p className="text-center text-xs text-gray-600 mt-4">
          Keys are stored locally in data/config.json (never sent anywhere).
        </p>
      </div>
    </div>
  );
}
