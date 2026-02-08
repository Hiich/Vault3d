import { useState, useEffect, useMemo } from "react";
import { discover, extractWallets, extractProfile } from "../lib/api.ts";
import type { DiscoveryResult, DiscoveredBrowser } from "../lib/api.ts";

interface FailedProfile {
  browserSlug: string;
  browserName: string;
  profile: string;
  walletName: string;
  walletSlug: string;
  error: string;
  password: string;
  retrying: boolean;
  resolved: boolean;
  retryResult?: { wallets: number; addresses: number };
  retryError?: string;
}

function parseProfileError(error: string): { browserProfile: string; walletName: string } | null {
  // Error format: [BrowserName/ProfileName] WalletName: message
  const match = error.match(/^\[([^\]]+)\] ([^:]+): /);
  if (!match) return null;
  return { browserProfile: match[1]!, walletName: match[2]! };
}

function isWrongPassword(error: string): boolean {
  return (
    error.includes("Unsupported state or unable to authenticate data") ||
    error.includes("stage 1: master key")
  );
}

export function Extract() {
  const [discovery, setDiscovery] = useState<DiscoveryResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [passwords, setPasswords] = useState<Record<string, string>>({});
  const [extracting, setExtracting] = useState(false);
  const [result, setResult] = useState<{ wallets: number; addresses: number; errors: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [failedProfiles, setFailedProfiles] = useState<FailedProfile[]>([]);

  useEffect(() => {
    discover()
      .then((data) => setDiscovery(data))
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to discover browsers"))
      .finally(() => setLoading(false));
  }, []);

  // Unique wallet slugs that need passwords (only show fields for what's installed)
  const requiredSlugs = useMemo(() => {
    if (!discovery) return [];
    const set = new Set<string>();
    for (const browser of discovery.browsers) {
      for (const profile of browser.profiles) {
        for (const wallet of profile.wallets) {
          set.add(wallet.slug);
        }
      }
    }
    return Array.from(set).sort();
  }, [discovery]);

  // Slug -> display name mapping
  const slugNames = useMemo(() => {
    const map: Record<string, string> = {};
    if (!discovery) return map;
    for (const browser of discovery.browsers) {
      for (const profile of browser.profiles) {
        for (const wallet of profile.wallets) {
          map[wallet.slug] = wallet.name;
        }
      }
    }
    return map;
  }, [discovery]);

  const totalProfiles = useMemo(() => {
    if (!discovery) return 0;
    return discovery.browsers.reduce((sum, b) => sum + b.profiles.length, 0);
  }, [discovery]);

  const totalWalletInstalls = useMemo(() => {
    if (!discovery) return 0;
    return discovery.browsers.reduce(
      (sum, b) => sum + b.profiles.reduce((ps, p) => ps + p.wallets.length, 0),
      0
    );
  }, [discovery]);

  const hasAnyPassword = Object.values(passwords).some((v) => v.trim());

  const handleExtract = async () => {
    setExtracting(true);
    setResult(null);
    setError(null);
    setFailedProfiles([]);
    try {
      // Build clean passwords map (only non-empty values)
      const cleanPasswords: Record<string, string> = {};
      for (const [slug, pw] of Object.entries(passwords)) {
        if (pw.trim()) cleanPasswords[slug] = pw.trim();
      }

      const data = await extractWallets({ passwords: cleanPasswords });
      setResult(data);

      // Parse errors to find wrong-password failures
      const failed: FailedProfile[] = [];
      for (const err of data.errors) {
        if (isWrongPassword(err)) {
          const parsed = parseProfileError(err);
          if (parsed) {
            // Find browser/profile info from the parsed error
            const parts = parsed.browserProfile.split("/");
            const browserName = parts[0] ?? "";
            const profileName = parts.slice(1).join("/") || "";

            // Find the browser slug from discovery
            const browser = discovery?.browsers.find((b) => b.name === browserName);

            // Find which wallet slug this relates to
            const walletSlug = Object.entries(slugNames).find(
              ([, name]) => name === parsed.walletName
            )?.[0] ?? parsed.walletName.toLowerCase();

            failed.push({
              browserSlug: browser?.slug ?? browserName.toLowerCase(),
              browserName,
              profile: profileName,
              walletName: parsed.walletName,
              walletSlug,
              error: err,
              password: "",
              retrying: false,
              resolved: false,
            });
          }
        }
      }
      setFailedProfiles(failed);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Extraction failed");
    } finally {
      setExtracting(false);
    }
  };

  const handleRetry = async (index: number) => {
    const fp = failedProfiles[index]!;
    if (!fp.password.trim()) return;

    setFailedProfiles((prev) =>
      prev.map((p, i) => (i === index ? { ...p, retrying: true, retryError: undefined } : p))
    );

    try {
      const data = await extractProfile({
        browserSlug: fp.browserSlug,
        profile: fp.profile,
        passwords: { [fp.walletSlug]: fp.password.trim() },
      });

      if (data.errors.length > 0) {
        setFailedProfiles((prev) =>
          prev.map((p, i) =>
            i === index
              ? { ...p, retrying: false, retryError: data.errors[0] }
              : p
          )
        );
      } else {
        setFailedProfiles((prev) =>
          prev.map((p, i) =>
            i === index
              ? { ...p, retrying: false, resolved: true, retryResult: { wallets: data.wallets, addresses: data.addresses } }
              : p
          )
        );
        setResult((prev) =>
          prev
            ? {
                ...prev,
                wallets: prev.wallets + data.wallets,
                addresses: prev.addresses + data.addresses,
              }
            : prev
        );
      }
    } catch (err) {
      setFailedProfiles((prev) =>
        prev.map((p, i) =>
          i === index
            ? { ...p, retrying: false, retryError: err instanceof Error ? err.message : "Retry failed" }
            : p
        )
      );
    }
  };

  const updateRetryPassword = (index: number, password: string) => {
    setFailedProfiles((prev) =>
      prev.map((p, i) => (i === index ? { ...p, password, retryError: undefined } : p))
    );
  };

  const otherErrors = result?.errors.filter((e) => !isWrongPassword(e)) ?? [];

  // Browser icon colors
  const browserColors: Record<string, string> = {
    brave: "text-orange-400",
    chrome: "text-blue-400",
    edge: "text-cyan-400",
    arc: "text-pink-400",
    opera: "text-red-400",
    chromium: "text-gray-400",
  };

  // Wallet badge colors
  const walletColors: Record<string, string> = {
    metamask: "bg-orange-500/20 text-orange-400",
    phantom: "bg-purple-500/20 text-purple-400",
    rabby: "bg-blue-500/20 text-blue-400",
    coinbase: "bg-indigo-500/20 text-indigo-400",
  };

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-xl font-bold">Extract Wallets</h2>
        <p className="text-sm text-gray-500 mt-1">
          Discover browsers, profiles, and wallet extensions
        </p>
      </div>

      {/* Discovery Tree */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 mb-6">
        <h3 className="text-sm font-semibold text-gray-300 mb-3">
          Discovered Browsers
          {!loading && discovery && (
            <span className="text-gray-600 font-normal ml-2">
              {discovery.browsers.length} browser{discovery.browsers.length !== 1 ? "s" : ""}, {totalProfiles} profile{totalProfiles !== 1 ? "s" : ""}, {totalWalletInstalls} wallet{totalWalletInstalls !== 1 ? "s" : ""}
            </span>
          )}
        </h3>
        {loading ? (
          <div className="text-sm text-gray-500">Scanning for browsers and wallet extensions...</div>
        ) : !discovery || discovery.browsers.length === 0 ? (
          <div className="text-sm text-gray-500">No browsers with wallet extensions found.</div>
        ) : (
          <div className="space-y-3">
            {discovery.browsers.map((browser) => (
              <BrowserNode key={browser.slug} browser={browser} browserColors={browserColors} walletColors={walletColors} />
            ))}
          </div>
        )}
      </div>

      {/* Dynamic Password Inputs */}
      {requiredSlugs.length > 0 && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 mb-6">
          <h3 className="text-sm font-semibold text-gray-300 mb-4">Wallet Passwords</h3>
          <div className={`grid grid-cols-1 ${requiredSlugs.length > 1 ? "md:grid-cols-2" : ""} gap-4`}>
            {requiredSlugs.map((slug) => (
              <div key={slug}>
                <label className="block text-xs text-gray-500 mb-1.5">{slugNames[slug] ?? slug} Password</label>
                <input
                  type="password"
                  value={passwords[slug] ?? ""}
                  onChange={(e) => setPasswords((prev) => ({ ...prev, [slug]: e.target.value }))}
                  placeholder={`Enter ${slugNames[slug] ?? slug} password`}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-blue-500"
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Extract Button */}
      <button
        onClick={handleExtract}
        disabled={extracting || !hasAnyPassword}
        className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white px-6 py-2.5 rounded-lg text-sm font-medium flex items-center gap-2"
      >
        {extracting ? (
          <>
            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Extracting...
          </>
        ) : (
          <>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
            </svg>
            Extract Wallets
          </>
        )}
      </button>

      {/* Error */}
      {error && (
        <div className="bg-red-900/30 border border-red-800 rounded-xl p-4 mt-6 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Results */}
      {result && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 mt-6">
          <h3 className="text-sm font-semibold text-gray-300 mb-3">Extraction Results</h3>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div className="bg-gray-800 rounded-lg p-3">
              <div className="text-2xl font-bold text-green-400">{result.wallets}</div>
              <div className="text-xs text-gray-500">Wallets extracted</div>
            </div>
            <div className="bg-gray-800 rounded-lg p-3">
              <div className="text-2xl font-bold text-blue-400">{result.addresses}</div>
              <div className="text-xs text-gray-500">Addresses found</div>
            </div>
          </div>

          {/* Other (non-password) errors */}
          {otherErrors.length > 0 && (
            <div className="mt-3">
              <h4 className="text-xs text-red-400 font-semibold mb-2">Errors ({otherErrors.length})</h4>
              <div className="space-y-1">
                {otherErrors.map((e, i) => (
                  <div key={i} className="text-xs text-red-300 bg-red-900/20 rounded-lg px-3 py-1.5">
                    {e}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Failed profiles — per-profile password retry */}
      {failedProfiles.length > 0 && (
        <div className="bg-yellow-900/20 border border-yellow-800/50 rounded-xl p-4 mt-6">
          <h3 className="text-sm font-semibold text-yellow-400 mb-1">
            Wrong password for {failedProfiles.filter((f) => !f.resolved).length} profile(s)
          </h3>
          <p className="text-xs text-gray-500 mb-4">
            These profiles have a different password. Enter the correct password for each and retry.
          </p>

          <div className="space-y-3">
            {failedProfiles.map((fp, i) => (
              <div
                key={`${fp.browserSlug}-${fp.profile}-${fp.walletSlug}`}
                className={`rounded-lg p-3 ${
                  fp.resolved
                    ? "bg-green-900/20 border border-green-800/50"
                    : "bg-gray-800 border border-gray-700"
                }`}
              >
                <div className="flex items-center gap-3">
                  {/* Browser/profile + wallet type label */}
                  <div className="shrink-0">
                    <span className="text-sm font-medium text-gray-200">{fp.browserName}/{fp.profile}</span>
                    <span className={`ml-2 text-xs px-2 py-0.5 rounded-full ${
                      walletColors[fp.walletSlug] ?? "bg-gray-500/20 text-gray-400"
                    }`}>
                      {fp.walletName}
                    </span>
                  </div>

                  {fp.resolved ? (
                    <div className="flex items-center gap-2 ml-auto">
                      <svg className="w-4 h-4 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                      <span className="text-xs text-green-400">
                        +{fp.retryResult?.wallets} wallet(s), +{fp.retryResult?.addresses} address(es)
                      </span>
                    </div>
                  ) : (
                    <>
                      <input
                        type="password"
                        value={fp.password}
                        onChange={(e) => updateRetryPassword(i, e.target.value)}
                        placeholder={`${fp.walletName} password for ${fp.browserName}/${fp.profile}`}
                        className="flex-1 bg-gray-900 border border-gray-600 rounded-lg px-3 py-1.5 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-blue-500"
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleRetry(i);
                        }}
                      />
                      <button
                        onClick={() => handleRetry(i)}
                        disabled={fp.retrying || !fp.password.trim()}
                        className="shrink-0 bg-yellow-600 hover:bg-yellow-700 disabled:opacity-50 disabled:cursor-not-allowed text-white px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5"
                      >
                        {fp.retrying ? (
                          <>
                            <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                            </svg>
                            Retrying...
                          </>
                        ) : (
                          "Retry"
                        )}
                      </button>
                    </>
                  )}
                </div>

                {fp.retryError && (
                  <div className="mt-2 text-xs text-red-400 bg-red-900/20 rounded px-2 py-1">
                    {fp.retryError}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// --- Browser tree node ---

function BrowserNode({
  browser,
  browserColors,
  walletColors,
}: {
  browser: DiscoveredBrowser;
  browserColors: Record<string, string>;
  walletColors: Record<string, string>;
}) {
  const [expanded, setExpanded] = useState(true);
  const totalWallets = browser.profiles.reduce((sum, p) => sum + p.wallets.length, 0);

  return (
    <div className="bg-gray-800/50 border border-gray-700/50 rounded-lg">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-gray-800/80 rounded-lg transition-colors"
      >
        <svg
          className={`w-3 h-3 text-gray-500 transition-transform ${expanded ? "rotate-90" : ""}`}
          fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
        </svg>
        <span className={`text-sm font-medium ${browserColors[browser.slug] ?? "text-gray-300"}`}>
          {browser.name}
        </span>
        <span className="text-xs text-gray-600">
          {browser.profiles.length} profile{browser.profiles.length !== 1 ? "s" : ""}, {totalWallets} wallet{totalWallets !== 1 ? "s" : ""}
        </span>
      </button>

      {expanded && (
        <div className="px-3 pb-2 space-y-1.5 ml-5">
          {browser.profiles.map((profile) => (
            <div key={profile.name} className="flex items-center gap-2 py-1">
              <span className="text-xs text-gray-400 font-mono">{profile.name}</span>
              <div className="flex flex-wrap gap-1">
                {profile.wallets.map((wallet) => (
                  <span
                    key={wallet.extensionId}
                    className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                      walletColors[wallet.slug] ?? "bg-gray-500/20 text-gray-400"
                    }`}
                  >
                    {wallet.name}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
