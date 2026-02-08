import os from "os";
import path from "path";
import fs from "fs-extra";

// --- Browser registry ---

export interface BrowserDef {
  name: string;
  slug: string;
  paths: { darwin?: string; linux?: string; win32?: string };
}

export const BROWSERS: BrowserDef[] = [
  {
    name: "Brave",
    slug: "brave",
    paths: {
      darwin: "Library/Application Support/BraveSoftware/Brave-Browser",
      linux: ".config/BraveSoftware/Brave-Browser",
      win32: "AppData/Local/BraveSoftware/Brave-Browser/User Data",
    },
  },
  {
    name: "Chrome",
    slug: "chrome",
    paths: {
      darwin: "Library/Application Support/Google/Chrome",
      linux: ".config/google-chrome",
      win32: "AppData/Local/Google/Chrome/User Data",
    },
  },
  {
    name: "Edge",
    slug: "edge",
    paths: {
      darwin: "Library/Application Support/Microsoft Edge",
      linux: ".config/microsoft-edge",
      win32: "AppData/Local/Microsoft/Edge/User Data",
    },
  },
  {
    name: "Arc",
    slug: "arc",
    paths: {
      darwin: "Library/Application Support/Arc/User Data",
    },
  },
  {
    name: "Opera",
    slug: "opera",
    paths: {
      darwin: "Library/Application Support/com.operasoftware.Opera",
      linux: ".config/opera",
      win32: "AppData/Roaming/Opera Software/Opera Stable",
    },
  },
  {
    name: "Chromium",
    slug: "chromium",
    paths: {
      darwin: "Library/Application Support/Chromium",
      linux: ".config/chromium",
      win32: "AppData/Local/Chromium/User Data",
    },
  },
];

// --- Wallet extension registry ---

export interface WalletExtensionDef {
  extensionId: string;
  name: string;
  slug: string;
  parser: "metamask" | "phantom";
}

export const WALLET_EXTENSIONS: WalletExtensionDef[] = [
  {
    extensionId: "nkbihfbeogaeaoehlefnkodbefgpgknn",
    name: "MetaMask",
    slug: "metamask",
    parser: "metamask",
  },
  {
    extensionId: "bfnaelmomeimhlpmgjnjophhpkkoljpa",
    name: "Phantom",
    slug: "phantom",
    parser: "phantom",
  },
  {
    extensionId: "acmacodkjbdgmoleebolmdjonilkdbch",
    name: "Rabby",
    slug: "rabby",
    parser: "metamask",
  },
  {
    extensionId: "hnfanknocfeofbddgcijnmhnfnkdnaad",
    name: "Coinbase Wallet",
    slug: "coinbase",
    parser: "metamask",
  },
];

// --- Discovery ---

export interface DiscoveredWallet {
  extensionId: string;
  name: string;
  slug: string;
  parser: "metamask" | "phantom";
  dataPath: string;
}

export interface DiscoveredProfile {
  name: string;
  wallets: DiscoveredWallet[];
}

export interface DiscoveredBrowser {
  name: string;
  slug: string;
  basePath: string;
  profiles: DiscoveredProfile[];
}

export interface DiscoveryResult {
  browsers: DiscoveredBrowser[];
}

function getBrowserBasePath(browser: BrowserDef): string | null {
  const platform = process.platform as "darwin" | "linux" | "win32";
  const relPath = browser.paths[platform];
  if (!relPath) return null;
  return path.join(os.homedir(), relPath);
}

function isProfileDir(name: string): boolean {
  return (
    name === "Default" ||
    name.startsWith("Profile ") ||
    name === "Guest Profile"
  );
}

async function discoverBrowser(browser: BrowserDef): Promise<DiscoveredBrowser | null> {
  const basePath = getBrowserBasePath(browser);
  if (!basePath) return null;

  const exists = await fs.pathExists(basePath);
  if (!exists) return null;

  let entries: fs.Dirent[];
  try {
    entries = await fs.readdir(basePath, { withFileTypes: true });
  } catch {
    return null;
  }

  const profileNames = entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter(isProfileDir);

  const profiles: DiscoveredProfile[] = [];
  for (const profileName of profileNames) {
    const wallets: DiscoveredWallet[] = [];
    for (const ext of WALLET_EXTENSIONS) {
      const dataPath = path.join(basePath, profileName, "Local Extension Settings", ext.extensionId);
      const extExists = await fs.pathExists(dataPath);
      if (extExists) {
        wallets.push({
          extensionId: ext.extensionId,
          name: ext.name,
          slug: ext.slug,
          parser: ext.parser,
          dataPath,
        });
      }
    }
    if (wallets.length > 0) {
      profiles.push({ name: profileName, wallets });
    }
  }

  if (profiles.length === 0) return null;

  return { name: browser.name, slug: browser.slug, basePath, profiles };
}

/**
 * Scan all known browsers on the current OS, find profiles,
 * and detect which wallet extensions are installed in each.
 */
export async function discoverAll(): Promise<DiscoveryResult> {
  const results = await Promise.all(BROWSERS.map(discoverBrowser));
  const browsers = results.filter((b): b is DiscoveredBrowser => b !== null);
  return { browsers };
}

/**
 * Get the LevelDB data path for a specific extension in a specific browser profile.
 * Used for single-profile extraction.
 */
export function getExtensionDataPathForBrowser(
  browserSlug: string,
  profileName: string,
  extensionId: string,
): string | null {
  const browser = BROWSERS.find((b) => b.slug === browserSlug);
  if (!browser) return null;
  const basePath = getBrowserBasePath(browser);
  if (!basePath) return null;
  return path.join(basePath, profileName, "Local Extension Settings", extensionId);
}

// --- Legacy exports for src/index.ts CLI ---

export const EXTENSION_IDS = {
  METAMASK: "nkbihfbeogaeaoehlefnkodbefgpgknn",
  PHANTOM: "bfnaelmomeimhlpmgjnjophhpkkoljpa",
} as const;

function getBravePath(): string {
  const platform = process.platform;
  if (platform === "linux") return path.join(os.homedir(), ".config/BraveSoftware/Brave-Browser");
  if (platform === "win32") return path.join(os.homedir(), "AppData/Local/BraveSoftware/Brave-Browser/User Data");
  return path.join(os.homedir(), "Library/Application Support/BraveSoftware/Brave-Browser");
}

export const BRAVE_BASE_PATH = getBravePath();

export async function discoverProfiles(): Promise<string[]> {
  const entries = await fs.readdir(BRAVE_BASE_PATH, { withFileTypes: true });
  return entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter(isProfileDir);
}

export function getExtensionDataPath(
  profile: string,
  extensionId: string
): string {
  return path.join(
    BRAVE_BASE_PATH,
    profile,
    "Local Extension Settings",
    extensionId
  );
}
