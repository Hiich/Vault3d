import { getDb, insertTransaction, updateTransactionStatus } from "../db.ts";
import { estimateEvmTx, sendEvmTx } from "../services/evm-tx.ts";
import type { WalletRow, AddressRow, EvmTxParams } from "../services/evm-tx.ts";
import { estimateSolanaTx, sendSolanaTx } from "../services/solana-tx.ts";
import type { SolanaWalletRow, SolanaTxParams } from "../services/solana-tx.ts";

interface TxRequestBody {
  fromAddressId: number;
  toAddress: string;
  chain: string;
  token: string;
  amount: string;
}

/**
 * Look up address and wallet from DB, determine chain type.
 */
function lookupAddressAndWallet(fromAddressId: number): {
  address: AddressRow;
  wallet: WalletRow;
} {
  const db = getDb();

  const address = db
    .prepare(
      `SELECT id, wallet_id, address, chain_type, derivation_index
       FROM addresses WHERE id = ?`
    )
    .get(fromAddressId) as AddressRow | null;

  if (!address) {
    throw new Error(`Address with id ${fromAddressId} not found`);
  }

  const wallet = db
    .prepare(
      `SELECT id, type, mnemonic, private_key
       FROM wallets WHERE id = ?`
    )
    .get(address.wallet_id) as WalletRow | null;

  if (!wallet) {
    throw new Error(`Wallet with id ${address.wallet_id} not found`);
  }

  return { address, wallet };
}

/**
 * POST /api/transactions/estimate
 * Body: { fromAddressId, toAddress, chain, token, amount }
 * Returns gas/fee estimate for the transaction.
 */
export async function postEstimate(req: Request): Promise<Response> {
  try {
    const body = (await req.json()) as TxRequestBody;

    if (!body.fromAddressId || !body.toAddress || !body.chain || !body.token || !body.amount) {
      return Response.json(
        { error: "Missing required fields: fromAddressId, toAddress, chain, token, amount" },
        { status: 400 }
      );
    }

    const { address, wallet } = lookupAddressAndWallet(body.fromAddressId);

    if (address.chain_type === "evm") {
      const params: EvmTxParams = {
        wallet,
        address,
        chain: body.chain,
        token: body.token,
        toAddress: body.toAddress,
        amount: body.amount,
      };

      const estimate = await estimateEvmTx(params);
      return Response.json({ chainType: "evm", ...estimate });
    }

    if (address.chain_type === "solana") {
      const solWallet: SolanaWalletRow = {
        id: wallet.id,
        type: wallet.type,
        private_key: wallet.private_key,
      };

      const params: SolanaTxParams = {
        wallet: solWallet,
        fromAddress: address.address,
        toAddress: body.toAddress,
        token: body.token,
        amount: body.amount,
      };

      const estimate = await estimateSolanaTx(params);
      return Response.json({ chainType: "solana", ...estimate });
    }

    return Response.json(
      { error: `Unsupported chain type: ${address.chain_type}` },
      { status: 400 }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ error: msg }, { status: 500 });
  }
}

/**
 * POST /api/transactions/send
 * Body: { fromAddressId, toAddress, chain, token, amount }
 * Signs and broadcasts the transaction. Creates a transaction record.
 */
export async function postSend(req: Request): Promise<Response> {
  try {
    const body = (await req.json()) as TxRequestBody;

    if (!body.fromAddressId || !body.toAddress || !body.chain || !body.token || !body.amount) {
      return Response.json(
        { error: "Missing required fields: fromAddressId, toAddress, chain, token, amount" },
        { status: 400 }
      );
    }

    const { address, wallet } = lookupAddressAndWallet(body.fromAddressId);

    // Create a pending transaction record
    const txId = insertTransaction({
      address_id: address.id,
      chain: body.chain,
      token: body.token,
      to_address: body.toAddress,
      amount: body.amount,
      amount_raw: "0", // Will be updated after send
      status: "pending",
    });

    try {
      if (address.chain_type === "evm") {
        const params: EvmTxParams = {
          wallet,
          address,
          chain: body.chain,
          token: body.token,
          toAddress: body.toAddress,
          amount: body.amount,
        };

        const result = await sendEvmTx(params);

        updateTransactionStatus(txId, "confirmed", result.txHash);

        // Update the amount_raw
        getDb()
          .prepare(`UPDATE transactions SET amount_raw = ? WHERE id = ?`)
          .run(result.amountRaw, txId);

        return Response.json({
          transactionId: txId,
          txHash: result.txHash,
          status: "confirmed",
          chainType: "evm",
        });
      }

      if (address.chain_type === "solana") {
        const solWallet: SolanaWalletRow = {
          id: wallet.id,
          type: wallet.type,
          private_key: wallet.private_key,
        };

        const params: SolanaTxParams = {
          wallet: solWallet,
          fromAddress: address.address,
          toAddress: body.toAddress,
          token: body.token,
          amount: body.amount,
        };

        const result = await sendSolanaTx(params);

        updateTransactionStatus(txId, "confirmed", result.txHash);

        // Update the amount_raw
        getDb()
          .prepare(`UPDATE transactions SET amount_raw = ? WHERE id = ?`)
          .run(result.amountRaw, txId);

        return Response.json({
          transactionId: txId,
          txHash: result.txHash,
          status: "confirmed",
          chainType: "solana",
        });
      }

      updateTransactionStatus(txId, "failed", null, `Unsupported chain type: ${address.chain_type}`);
      return Response.json(
        { error: `Unsupported chain type: ${address.chain_type}` },
        { status: 400 }
      );
    } catch (sendErr) {
      const sendMsg = sendErr instanceof Error ? sendErr.message : String(sendErr);
      updateTransactionStatus(txId, "failed", null, sendMsg);
      return Response.json(
        { transactionId: txId, error: sendMsg, status: "failed" },
        { status: 500 }
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ error: msg }, { status: 500 });
  }
}

/**
 * POST /api/tx/bulk-send
 * Body: { transfers: Array<{ fromAddressId, toAddress, chain, token, amount }> }
 * Processes transfers sequentially. "max" amount sweeps full balance.
 */
export async function postBulkSend(req: Request): Promise<Response> {
  try {
    const body = (await req.json()) as {
      transfers: Array<{
        fromAddressId: number;
        toAddress: string;
        chain: string;
        token: string;
        amount: string;
      }>;
    };

    if (!body.transfers || !Array.isArray(body.transfers) || body.transfers.length === 0) {
      return Response.json(
        { error: "Missing or empty 'transfers' array" },
        { status: 400 }
      );
    }

    const results: Array<{
      fromAddressId: number;
      txHash?: string;
      txId?: number;
      status: "confirmed" | "failed";
      error?: string;
    }> = [];

    let succeeded = 0;
    let failed = 0;

    for (const transfer of body.transfers) {
      try {
        const { address, wallet } = lookupAddressAndWallet(transfer.fromAddressId);

        // Resolve "max" amount
        let amount = transfer.amount;
        if (amount === "max") {
          const db = getDb();
          const balanceRow = db
            .prepare(
              `SELECT balance FROM balances WHERE address_id = ? AND chain = ? AND token = ?`
            )
            .get(address.id, transfer.chain, transfer.token) as { balance: string } | null;

          if (!balanceRow || parseFloat(balanceRow.balance) <= 0) {
            results.push({
              fromAddressId: transfer.fromAddressId,
              status: "failed",
              error: "No balance available to send",
            });
            failed++;
            continue;
          }
          amount = balanceRow.balance;
        }

        // Create pending transaction record
        const txId = insertTransaction({
          address_id: address.id,
          chain: transfer.chain,
          token: transfer.token,
          to_address: transfer.toAddress,
          amount,
          amount_raw: "0",
          status: "pending",
        });

        try {
          if (address.chain_type === "evm") {
            const params: EvmTxParams = {
              wallet,
              address,
              chain: transfer.chain,
              token: transfer.token,
              toAddress: transfer.toAddress,
              amount,
            };
            const result = await sendEvmTx(params);
            updateTransactionStatus(txId, "confirmed", result.txHash);
            getDb()
              .prepare(`UPDATE transactions SET amount_raw = ? WHERE id = ?`)
              .run(result.amountRaw, txId);

            results.push({
              fromAddressId: transfer.fromAddressId,
              txHash: result.txHash,
              txId,
              status: "confirmed",
            });
            succeeded++;
          } else if (address.chain_type === "solana") {
            const solWallet: SolanaWalletRow = {
              id: wallet.id,
              type: wallet.type,
              private_key: wallet.private_key,
            };
            const params: SolanaTxParams = {
              wallet: solWallet,
              fromAddress: address.address,
              toAddress: transfer.toAddress,
              token: transfer.token,
              amount,
            };
            const result = await sendSolanaTx(params);
            updateTransactionStatus(txId, "confirmed", result.txHash);
            getDb()
              .prepare(`UPDATE transactions SET amount_raw = ? WHERE id = ?`)
              .run(result.amountRaw, txId);

            results.push({
              fromAddressId: transfer.fromAddressId,
              txHash: result.txHash,
              txId,
              status: "confirmed",
            });
            succeeded++;
          } else {
            updateTransactionStatus(txId, "failed", null, `Unsupported chain type: ${address.chain_type}`);
            results.push({
              fromAddressId: transfer.fromAddressId,
              txId,
              status: "failed",
              error: `Unsupported chain type: ${address.chain_type}`,
            });
            failed++;
          }
        } catch (sendErr) {
          const sendMsg = sendErr instanceof Error ? sendErr.message : String(sendErr);
          updateTransactionStatus(txId, "failed", null, sendMsg);
          results.push({
            fromAddressId: transfer.fromAddressId,
            txId,
            status: "failed",
            error: sendMsg,
          });
          failed++;
        }
      } catch (lookupErr) {
        const msg = lookupErr instanceof Error ? lookupErr.message : String(lookupErr);
        results.push({
          fromAddressId: transfer.fromAddressId,
          status: "failed",
          error: msg,
        });
        failed++;
      }
    }

    return Response.json({
      results,
      summary: { total: body.transfers.length, succeeded, failed },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ error: msg }, { status: 500 });
  }
}

/**
 * GET /api/transactions
 * Query params:
 *   - address_id: filter by source address
 *   - chain: filter by chain
 *   - status: filter by status (pending, confirmed, failed)
 *   - page: page number (default 1)
 *   - limit: results per page (default 50)
 */
export async function listTransactions(req: Request): Promise<Response> {
  try {
    const url = new URL(req.url);
    const addressId = url.searchParams.get("address_id");
    const chain = url.searchParams.get("chain");
    const status = url.searchParams.get("status");
    const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1", 10));
    const limit = Math.min(200, Math.max(1, parseInt(url.searchParams.get("limit") ?? "50", 10)));
    const offset = (page - 1) * limit;

    const db = getDb();
    const conditions: string[] = [];
    const params: Record<string, string | number> = {};

    if (addressId) {
      conditions.push("t.address_id = $address_id");
      params.$address_id = parseInt(addressId, 10);
    }
    if (chain) {
      conditions.push("t.chain = $chain");
      params.$chain = chain;
    }
    if (status) {
      conditions.push("t.status = $status");
      params.$status = status;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    // Count
    const countSql = `SELECT COUNT(*) AS total FROM transactions t ${whereClause}`;
    const countResult = db.prepare(countSql).get(params) as { total: number };
    const total = countResult.total;

    // Main query with address info
    const sql = `
      SELECT
        t.id,
        t.address_id,
        t.chain,
        t.token,
        t.to_address,
        t.amount,
        t.amount_raw,
        t.tx_hash,
        t.status,
        t.error,
        t.created_at,
        a.address AS from_address,
        a.chain_type
      FROM transactions t
      JOIN addresses a ON a.id = t.address_id
      ${whereClause}
      ORDER BY t.created_at DESC
      LIMIT $limit OFFSET $offset
    `;
    params.$limit = limit;
    params.$offset = offset;

    const transactions = db.prepare(sql).all(params);

    return Response.json({
      transactions,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ error: msg }, { status: 500 });
  }
}
