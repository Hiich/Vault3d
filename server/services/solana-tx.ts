import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
  getAccount as getTokenAccount,
} from "@solana/spl-token";
import bs58 from "bs58";

// --- Config ---

const HELIUS_API_KEY = process.env.HELIUS_API_KEY ?? "";
const SOLANA_RPC = `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`;
const USDC_MINT = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
const USDC_DECIMALS = 6;

function getConnection(): Connection {
  return new Connection(SOLANA_RPC, "confirmed");
}

// --- Keypair reconstruction ---

export interface SolanaWalletRow {
  id: number;
  type: string;
  private_key: string | null; // base58-encoded Ed25519 keypair (64 bytes)
}

/**
 * Reconstruct a Solana Keypair from a base58-encoded secret key stored in DB.
 */
export function getKeypair(wallet: SolanaWalletRow): Keypair {
  if (!wallet.private_key) {
    throw new Error("Wallet has no private key");
  }
  const secretKeyBytes = bs58.decode(wallet.private_key);
  return Keypair.fromSecretKey(secretKeyBytes);
}

// --- Transaction parameters ---

export interface SolanaTxParams {
  wallet: SolanaWalletRow;
  fromAddress: string;
  toAddress: string;
  token: string; // "native", "SOL", or "USDC"
  amount: string; // human-readable amount
}

function isNativeToken(token: string): boolean {
  return token === "native" || token === "SOL";
}

function parseAmount(amount: string, decimals: number): bigint {
  const parts = amount.split(".");
  const whole = parts[0] ?? "0";
  let frac = parts[1] ?? "";

  // Pad or truncate fractional part to match decimals
  if (frac.length > decimals) {
    frac = frac.slice(0, decimals);
  } else {
    frac = frac.padEnd(decimals, "0");
  }

  return BigInt(whole + frac);
}

/**
 * Estimate transaction fees for a Solana transaction.
 */
export async function estimateSolanaTx(params: SolanaTxParams): Promise<{
  estimatedFee: string;
  estimatedFeeLamports: string;
}> {
  const connection = getConnection();
  const keypair = getKeypair(params.wallet);
  const toPubkey = new PublicKey(params.toAddress);

  const transaction = new Transaction();

  if (isNativeToken(params.token)) {
    const lamports = parseAmount(params.amount, 9);
    transaction.add(
      SystemProgram.transfer({
        fromPubkey: keypair.publicKey,
        toPubkey,
        lamports: Number(lamports),
      })
    );
  } else if (params.token === "USDC") {
    const amount = parseAmount(params.amount, USDC_DECIMALS);

    const fromAta = await getAssociatedTokenAddress(USDC_MINT, keypair.publicKey);
    const toAta = await getAssociatedTokenAddress(USDC_MINT, toPubkey);

    // Check if recipient ATA exists
    try {
      await getTokenAccount(connection, toAta);
    } catch {
      // ATA doesn't exist, add creation instruction
      transaction.add(
        createAssociatedTokenAccountInstruction(
          keypair.publicKey,
          toAta,
          toPubkey,
          USDC_MINT
        )
      );
    }

    transaction.add(
      createTransferInstruction(fromAta, toAta, keypair.publicKey, Number(amount))
    );
  } else {
    throw new Error(`Unsupported Solana token: ${params.token}`);
  }

  const { blockhash } = await connection.getLatestBlockhash();
  transaction.recentBlockhash = blockhash;
  transaction.feePayer = keypair.publicKey;

  const fee = await transaction.getEstimatedFee(connection);
  const feeLamports = fee ?? 5000; // Default estimate if null

  return {
    estimatedFee: (feeLamports / LAMPORTS_PER_SOL).toString(),
    estimatedFeeLamports: feeLamports.toString(),
  };
}

/**
 * Sign and broadcast a Solana transaction.
 * Returns the transaction signature.
 */
export async function sendSolanaTx(params: SolanaTxParams): Promise<{
  txHash: string;
  amountRaw: string;
}> {
  const connection = getConnection();
  const keypair = getKeypair(params.wallet);
  const toPubkey = new PublicKey(params.toAddress);

  const transaction = new Transaction();
  let amountRaw: string;

  if (isNativeToken(params.token)) {
    const lamports = parseAmount(params.amount, 9);
    amountRaw = lamports.toString();

    transaction.add(
      SystemProgram.transfer({
        fromPubkey: keypair.publicKey,
        toPubkey,
        lamports: Number(lamports),
      })
    );
  } else if (params.token === "USDC") {
    const amount = parseAmount(params.amount, USDC_DECIMALS);
    amountRaw = amount.toString();

    const fromAta = await getAssociatedTokenAddress(USDC_MINT, keypair.publicKey);
    const toAta = await getAssociatedTokenAddress(USDC_MINT, toPubkey);

    // Check if recipient ATA exists
    try {
      await getTokenAccount(connection, toAta);
    } catch {
      // ATA doesn't exist, add creation instruction
      transaction.add(
        createAssociatedTokenAccountInstruction(
          keypair.publicKey,
          toAta,
          toPubkey,
          USDC_MINT
        )
      );
    }

    transaction.add(
      createTransferInstruction(fromAta, toAta, keypair.publicKey, Number(amount))
    );
  } else {
    throw new Error(`Unsupported Solana token: ${params.token}`);
  }

  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
  transaction.recentBlockhash = blockhash;
  transaction.feePayer = keypair.publicKey;

  transaction.sign(keypair);

  const rawTx = transaction.serialize();
  const txHash = await connection.sendRawTransaction(rawTx, {
    skipPreflight: false,
    preflightCommitment: "confirmed",
  });

  // Wait for confirmation
  await connection.confirmTransaction(
    { signature: txHash, blockhash, lastValidBlockHeight },
    "confirmed"
  );

  return { txHash, amountRaw };
}
