import { useState, useEffect } from "react";
import { getConfigStatus, saveConfig, getCustomTokens, addCustomToken, deleteCustomToken } from "../lib/api.ts";
import type { ConfigStatus, CustomToken } from "../lib/api.ts";

const CHAIN_OPTIONS = [
  { value: "ethereum", label: "Ethereum", type: "evm" as const },
  { value: "base", label: "Base", type: "evm" as const },
  { value: "polygon", label: "Polygon", type: "evm" as const },
  { value: "abstract", label: "Abstract", type: "evm" as const },
  { value: "solana", label: "Solana", type: "solana" as const },
];

export function Settings() {
  const [config, setConfig] = useState<ConfigStatus | null>(null);
  const [alchemyKey, setAlchemyKey] = useState("");
  const [heliusKey, setHeliusKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Custom tokens state
  const [tokens, setTokens] = useState<CustomToken[]>([]);
  const [tokenChain, setTokenChain] = useState("ethereum");
  const [tokenName, setTokenName] = useState("");
  const [tokenContract, setTokenContract] = useState("");
  const [tokenDecimals, setTokenDecimals] = useState("18");
  const [addingToken, setAddingToken] = useState(false);
  const [tokenError, setTokenError] = useState<string | null>(null);

  const fetchTokens = () => {
    getCustomTokens().then((data) => setTokens(data.tokens)).catch(() => {});
  };

  useEffect(() => {
    getConfigStatus().then(setConfig).catch(() => {});
    fetchTokens();
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
            Keys saved. Changes take effect immediately.
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

      {/* Custom Tokens Section */}
      <div className="mt-10 max-w-xl">
        <div className="mb-4">
          <h2 className="text-xl font-bold">Custom Tokens</h2>
          <p className="text-sm text-gray-500 mt-1">
            Default tokens (USDC, USDT) are always tracked. Add custom ERC-20 or SPL tokens below.
          </p>
        </div>

        {/* Add token form */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Chain</label>
              <select
                value={tokenChain}
                onChange={(e) => {
                  setTokenChain(e.target.value);
                  const opt = CHAIN_OPTIONS.find((c) => c.value === e.target.value);
                  setTokenDecimals(opt?.type === "solana" ? "9" : "18");
                }}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-blue-500"
              >
                {CHAIN_OPTIONS.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Token Name</label>
              <input
                type="text"
                value={tokenName}
                onChange={(e) => setTokenName(e.target.value)}
                placeholder="e.g. DAI, WETH"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs text-gray-500 mb-1">Contract Address</label>
            <input
              type="text"
              value={tokenContract}
              onChange={(e) => setTokenContract(e.target.value)}
              placeholder={tokenChain === "solana" ? "SPL mint address..." : "0x..."}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-500 font-mono focus:outline-none focus:border-blue-500"
            />
          </div>

          <div className="flex items-end gap-3">
            <div className="w-32">
              <label className="block text-xs text-gray-500 mb-1">Decimals</label>
              <input
                type="number"
                value={tokenDecimals}
                onChange={(e) => setTokenDecimals(e.target.value)}
                min={0}
                max={18}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-blue-500"
              />
            </div>
            <button
              onClick={async () => {
                if (!tokenName.trim() || !tokenContract.trim()) return;
                setAddingToken(true);
                setTokenError(null);
                try {
                  const chainOpt = CHAIN_OPTIONS.find((c) => c.value === tokenChain);
                  await addCustomToken({
                    chain: tokenChain,
                    name: tokenName.trim(),
                    contract: tokenContract.trim(),
                    decimals: parseInt(tokenDecimals, 10) || 18,
                    type: chainOpt?.type ?? "evm",
                  });
                  setTokenName("");
                  setTokenContract("");
                  setTokenDecimals(chainOpt?.type === "solana" ? "9" : "18");
                  fetchTokens();
                } catch (err) {
                  setTokenError(err instanceof Error ? err.message : "Failed to add token");
                } finally {
                  setAddingToken(false);
                }
              }}
              disabled={addingToken || !tokenName.trim() || !tokenContract.trim()}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium rounded-lg transition-colors whitespace-nowrap"
            >
              {addingToken ? "Adding..." : "Add Token"}
            </button>
          </div>

          {tokenError && (
            <div className="text-sm text-red-400 bg-red-400/10 rounded-lg px-3 py-2">
              {tokenError}
            </div>
          )}
        </div>

        {/* Token list */}
        {tokens.length > 0 && (
          <div className="mt-4 bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800 text-xs text-gray-500 uppercase tracking-wider">
                  <th className="px-4 py-2.5 text-left">Chain</th>
                  <th className="px-4 py-2.5 text-left">Token</th>
                  <th className="px-4 py-2.5 text-left">Contract</th>
                  <th className="px-4 py-2.5 text-center">Decimals</th>
                  <th className="px-4 py-2.5 text-right w-16"></th>
                </tr>
              </thead>
              <tbody>
                {tokens.map((t) => (
                  <tr key={t.id} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                    <td className="px-4 py-2">
                      <span className={`text-xs px-1.5 py-0.5 rounded ${t.type === "evm" ? "bg-blue-500/20 text-blue-400" : "bg-purple-500/20 text-purple-400"}`}>
                        {t.chain}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-gray-200 font-medium">{t.name}</td>
                    <td className="px-4 py-2 font-mono text-xs text-gray-400" title={t.contract}>
                      {t.contract.slice(0, 6)}...{t.contract.slice(-4)}
                    </td>
                    <td className="px-4 py-2 text-center text-gray-400">{t.decimals}</td>
                    <td className="px-4 py-2 text-right">
                      <button
                        onClick={async () => {
                          await deleteCustomToken(t.id);
                          fetchTokens();
                        }}
                        className="text-gray-600 hover:text-red-400 p-0.5"
                        title="Remove token"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                        </svg>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
