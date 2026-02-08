import { discoverProfiles } from "../../src/config.ts";
import { extractWallets, extractProfile } from "../services/extraction.ts";

/**
 * GET /api/profiles
 * Returns all discovered browser profiles.
 */
export async function getProfiles(_req: Request): Promise<Response> {
  try {
    const profiles = await discoverProfiles();
    return Response.json({ profiles });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ error: `Failed to discover profiles: ${msg}` }, { status: 500 });
  }
}

/**
 * POST /api/extract
 * Body: { metamaskPassword?: string, phantomPassword?: string }
 * Extracts wallets from all profiles and persists to DB.
 */
export async function postExtract(req: Request): Promise<Response> {
  try {
    const body = (await req.json()) as {
      metamaskPassword?: string;
      phantomPassword?: string;
    };

    if (!body.metamaskPassword && !body.phantomPassword) {
      return Response.json(
        { error: "At least one password (metamaskPassword or phantomPassword) is required" },
        { status: 400 }
      );
    }

    const result = await extractWallets({
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
 * Body: { profile: string, metamaskPassword?: string, phantomPassword?: string }
 * Extracts wallets from a single profile with per-profile passwords.
 */
export async function postExtractProfile(req: Request): Promise<Response> {
  try {
    const body = (await req.json()) as {
      profile: string;
      metamaskPassword?: string;
      phantomPassword?: string;
    };

    if (!body.profile) {
      return Response.json({ error: "Missing required field: profile" }, { status: 400 });
    }

    if (!body.metamaskPassword && !body.phantomPassword) {
      return Response.json(
        { error: "At least one password is required" },
        { status: 400 }
      );
    }

    const result = await extractProfile({
      profile: body.profile,
      metamaskPassword: body.metamaskPassword,
      phantomPassword: body.phantomPassword,
    });

    return Response.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ error: `Extraction failed: ${msg}` }, { status: 500 });
  }
}
