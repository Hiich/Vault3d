import { discoverAll } from "../../src/config.ts";
import { extractWallets, extractProfile } from "../services/extraction.ts";

/**
 * GET /api/discover
 * Returns the full browser/profile/wallet discovery tree.
 */
export async function getDiscovery(_req: Request): Promise<Response> {
  try {
    const result = await discoverAll();
    return Response.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ error: `Discovery failed: ${msg}` }, { status: 500 });
  }
}

/**
 * POST /api/extract
 * Body: { passwords?: Record<string, string>, metamaskPassword?: string, phantomPassword?: string }
 * Extracts wallets from all discovered browsers/profiles and persists to DB.
 */
export async function postExtract(req: Request): Promise<Response> {
  try {
    const body = (await req.json()) as {
      passwords?: Record<string, string>;
      metamaskPassword?: string;
      phantomPassword?: string;
    };

    if (!body.passwords && !body.metamaskPassword && !body.phantomPassword) {
      return Response.json(
        { error: "At least one password is required (passwords map, metamaskPassword, or phantomPassword)" },
        { status: 400 }
      );
    }

    const result = await extractWallets({
      passwords: body.passwords,
      metamaskPassword: body.metamaskPassword,
      phantomPassword: body.phantomPassword,
    });

    return Response.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ error: `Extraction failed: ${msg}` }, { status: 500 });
  }
}

/**
 * POST /api/extract/profile
 * Body: { browserSlug: string, profile: string, passwords?: Record<string, string>, metamaskPassword?: string, phantomPassword?: string }
 * Extracts wallets from a single browser profile with per-extension passwords.
 */
export async function postExtractProfile(req: Request): Promise<Response> {
  try {
    const body = (await req.json()) as {
      browserSlug: string;
      profile: string;
      passwords?: Record<string, string>;
      metamaskPassword?: string;
      phantomPassword?: string;
    };

    if (!body.browserSlug || !body.profile) {
      return Response.json({ error: "Missing required fields: browserSlug and profile" }, { status: 400 });
    }

    if (!body.passwords && !body.metamaskPassword && !body.phantomPassword) {
      return Response.json(
        { error: "At least one password is required" },
        { status: 400 }
      );
    }

    const result = await extractProfile({
      browserSlug: body.browserSlug,
      profile: body.profile,
      passwords: body.passwords,
      metamaskPassword: body.metamaskPassword,
      phantomPassword: body.phantomPassword,
    });

    return Response.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ error: `Extraction failed: ${msg}` }, { status: 500 });
  }
}
