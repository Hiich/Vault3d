import { getCustomTokens, insertCustomToken, deleteCustomToken } from "../db.ts";
import { getTokenMap } from "../services/token-registry.ts";

const KNOWN_CHAINS = ["ethereum", "base", "polygon", "abstract", "solana"];
const EVM_CONTRACT_RE = /^0x[0-9a-fA-F]{40}$/;
const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export async function listCustomTokens(_req: Request): Promise<Response> {
  const tokens = getCustomTokens();
  return Response.json({ tokens });
}

export async function addCustomToken(req: Request): Promise<Response> {
  const body = (await req.json()) as {
    chain?: string;
    name?: string;
    contract?: string;
    decimals?: number;
    type?: string;
  };

  const { chain, name, contract, decimals, type } = body;

  if (!chain || !name || !contract || decimals == null || !type) {
    return Response.json(
      { error: "Missing required fields: chain, name, contract, decimals, type" },
      { status: 400 }
    );
  }

  if (!KNOWN_CHAINS.includes(chain)) {
    return Response.json(
      { error: `Unknown chain: ${chain}. Must be one of: ${KNOWN_CHAINS.join(", ")}` },
      { status: 400 }
    );
  }

  if (type !== "evm" && type !== "solana") {
    return Response.json({ error: 'type must be "evm" or "solana"' }, { status: 400 });
  }

  if (chain === "solana" && type !== "solana") {
    return Response.json({ error: 'Solana chain requires type "solana"' }, { status: 400 });
  }

  if (chain !== "solana" && type !== "evm") {
    return Response.json({ error: 'EVM chains require type "evm"' }, { status: 400 });
  }

  // Validate contract format
  if (type === "evm" && !EVM_CONTRACT_RE.test(contract)) {
    return Response.json(
      { error: "Invalid EVM contract address. Must be 0x followed by 40 hex characters." },
      { status: 400 }
    );
  }

  if (type === "solana" && !BASE58_RE.test(contract)) {
    return Response.json(
      { error: "Invalid Solana mint address. Must be a base58-encoded public key." },
      { status: 400 }
    );
  }

  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) {
    return Response.json(
      { error: "decimals must be an integer between 0 and 18" },
      { status: 400 }
    );
  }

  try {
    const id = insertCustomToken({ chain, name, contract, decimals, type });
    return Response.json({ id });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("UNIQUE constraint")) {
      return Response.json(
        { error: "A token with this contract already exists on this chain" },
        { status: 409 }
      );
    }
    return Response.json({ error: msg }, { status: 500 });
  }
}

export async function removeCustomToken(
  _req: Request,
  id: number
): Promise<Response> {
  deleteCustomToken(id);
  return Response.json({ success: true });
}

export async function getAllTokens(_req: Request): Promise<Response> {
  const tokens = getTokenMap();
  return Response.json({ tokens });
}
