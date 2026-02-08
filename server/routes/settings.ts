import { getConfig, hasAlchemyKey, hasHeliusKey, isConfigured, updateConfig } from "../config.ts";

/**
 * GET /api/settings
 * Returns config status (never actual key values).
 */
export function getSettings(_req: Request): Response {
  const config = getConfig();

  return Response.json({
    hasAlchemyKey: hasAlchemyKey(),
    hasHeliusKey: hasHeliusKey(),
    isConfigured: isConfigured(),
    setupCompletedAt: config.setup_completed_at,
  });
}

/**
 * POST /api/settings
 * Body: { alchemy_api_key?, helius_api_key?, completeSetup? }
 * Saves config, updates process.env.
 */
export async function postSettings(req: Request): Promise<Response> {
  try {
    const body = (await req.json()) as {
      alchemy_api_key?: string;
      helius_api_key?: string;
      completeSetup?: boolean;
    };

    const updates: Parameters<typeof updateConfig>[0] = {};

    if (body.alchemy_api_key !== undefined) {
      updates.alchemy_api_key = body.alchemy_api_key.trim();
    }
    if (body.helius_api_key !== undefined) {
      updates.helius_api_key = body.helius_api_key.trim();
    }
    if (body.completeSetup) {
      updates.setup_completed_at = new Date().toISOString();
    }

    updateConfig(updates);

    return Response.json({ saved: true, restartRequired: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ error: msg }, { status: 500 });
  }
}
