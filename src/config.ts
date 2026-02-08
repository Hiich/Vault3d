import os from "os";
import path from "path";
import fs from "fs-extra";

export const EXTENSION_IDS = {
  METAMASK: "nkbihfbeogaeaoehlefnkodbefgpgknn",
  PHANTOM: "bfnaelmomeimhlpmgjnjophhpkkoljpa",
} as const;

export const BRAVE_BASE_PATH = path.join(
  os.homedir(),
  "Library/Application Support/BraveSoftware/Brave-Browser"
);

export async function discoverProfiles(): Promise<string[]> {
  const entries = await fs.readdir(BRAVE_BASE_PATH, { withFileTypes: true });
  return entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter(
      (name) =>
        name === "Default" ||
        name.startsWith("Profile ") ||
        name === "Guest Profile"
    );
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
