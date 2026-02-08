import { useState, useEffect } from "react";
import { getProfiles, extractWallets, extractProfile } from "../lib/api.ts";

interface FailedProfile {
  profile: string;
  wallet: string; // "MetaMask" or "Phantom"
  error: string;
  password: string;
  retrying: boolean;
  resolved: boolean;
  retryResult?: { wallets: number; addresses: number };
  retryError?: string;
}

function parseProfileError(error: string): { profile: string; wallet: string } | null {
  const match = error.match(/^\[(.+?)\] (MetaMask|Phantom): /);
  if (!match) return null;
  return { profile: match[1]!, wallet: match[2]! };
}

function isWrongPassword(error: string): boolean {
  return (
    error.includes("Unsupported state or unable to authenticate data") ||
    error.includes("stage 1: master key")
  );
}

export function Extract() {
  const [profiles, setProfiles] = useState<string[]>([]);
  const [loadingProfiles, setLoadingProfiles] = useState(true);
  const [metamaskPassword, setMetamaskPassword] = useState("");
  const [phantomPassword, setPhantomPassword] = useState("");
  const [extracting, setExtracting] = useState(false);
  const [result, setResult] = useState<{ wallets: number; addresses: number; errors: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [failedProfiles, setFailedProfiles] = useState<FailedProfile[]>([]);

  useEffect(() => {
    getProfiles()
      .then((data) => setProfiles(data.profiles))
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load profiles"))
      .finally(() => setLoadingProfiles(false));
  }, []);

  const handleExtract = async () => {
    setExtracting(true);
    setResult(null);
    setError(null);
    setFailedProfiles([]);
    try {
      const body: { metamaskPassword?: string; phantomPassword?: string } = {};
      if (metamaskPassword.trim()) body.metamaskPassword = metamaskPassword.trim();
      if (phantomPassword.trim()) body.phantomPassword = phantomPassword.trim();
      const data = await extractWallets(body);
      setResult(data);

      // Parse errors to find wrong-password failures
      const failed: FailedProfile[] = [];
      for (const err of data.errors) {
        if (isWrongPassword(err)) {
          const parsed = parseProfileError(err);
          if (parsed) {
            failed.push({
              profile: parsed.profile,
              wallet: parsed.wallet,
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
      const body: { profile: string; metamaskPassword?: string; phantomPassword?: string } = {
        profile: fp.profile,
      };
      if (fp.wallet === "MetaMask") body.metamaskPassword = fp.password.trim();
      if (fp.wallet === "Phantom") body.phantomPassword = fp.password.trim();

      const data = await extractProfile(body);

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
        // Update totals
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

  const updatePassword = (index: number, password: string) => {
    setFailedProfiles((prev) =>
      prev.map((p, i) => (i === index ? { ...p, password, retryError: undefined } : p))
    );
  };

  const otherErrors = result?.errors.filter((e) => !isWrongPassword(e)) ?? [];

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-xl font-bold">Extract Wallets</h2>
        <p className="text-sm text-gray-500 mt-1">
          Discover browser profiles and extract wallet data
        </p>
      </div>

      {/* Discovered Profiles */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 mb-6">
        <h3 className="text-sm font-semibold text-gray-300 mb-3">Discovered Profiles</h3>
        {loadingProfiles ? (
          <div className="text-sm text-gray-500">Scanning for browser profiles...</div>
        ) : profiles.length === 0 ? (
          <div className="text-sm text-gray-500">No browser profiles found.</div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {profiles.map((p) => (
              <span
                key={p}
                className="bg-gray-800 border border-gray-700 text-gray-300 text-xs px-3 py-1.5 rounded-lg"
              >
                {p}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Password Inputs */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 mb-6">
        <h3 className="text-sm font-semibold text-gray-300 mb-4">Wallet Passwords</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-gray-500 mb-1.5">MetaMask Password</label>
            <input
              type="password"
              value={metamaskPassword}
              onChange={(e) => setMetamaskPassword(e.target.value)}
              placeholder="Enter MetaMask password"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1.5">Phantom Password</label>
            <input
              type="password"
              value={phantomPassword}
              onChange={(e) => setPhantomPassword(e.target.value)}
              placeholder="Enter Phantom password"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-blue-500"
            />
          </div>
        </div>
      </div>

      {/* Extract Button */}
      <button
        onClick={handleExtract}
        disabled={extracting || (!metamaskPassword.trim() && !phantomPassword.trim())}
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
                key={`${fp.profile}-${fp.wallet}`}
                className={`rounded-lg p-3 ${
                  fp.resolved
                    ? "bg-green-900/20 border border-green-800/50"
                    : "bg-gray-800 border border-gray-700"
                }`}
              >
                <div className="flex items-center gap-3">
                  {/* Profile + wallet type label */}
                  <div className="shrink-0">
                    <span className="text-sm font-medium text-gray-200">{fp.profile}</span>
                    <span className={`ml-2 text-xs px-2 py-0.5 rounded-full ${
                      fp.wallet === "MetaMask"
                        ? "bg-orange-500/20 text-orange-400"
                        : "bg-purple-500/20 text-purple-400"
                    }`}>
                      {fp.wallet}
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
                      {/* Password input */}
                      <input
                        type="password"
                        value={fp.password}
                        onChange={(e) => updatePassword(i, e.target.value)}
                        placeholder={`${fp.wallet} password for ${fp.profile}`}
                        className="flex-1 bg-gray-900 border border-gray-600 rounded-lg px-3 py-1.5 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-blue-500"
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleRetry(i);
                        }}
                      />

                      {/* Retry button */}
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

                {/* Retry error */}
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
