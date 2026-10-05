import type { Request, Response } from 'express';
import { TransactionBuilder, Networks } from '@stellar/stellar-sdk';
import { getPendingActionByHash, markPendingActionSubmitted } from '../../services/pending-actions.js';
import {
  trustlessWorkRequest,
  extractTransactionHash,
} from '../../services/trustlesswork.js';
import {
  dbInitializeEscrow,
  dbFundEscrow,
  dbMarkMilestoneCompleted,
  dbApproveMilestone,
  dbReleaseFunds,
  dbDisputeEscrow,
  dbResolveDispute,
  assertEscrowActionAllowed,
} from '../../services/escrow-db.js';
import {
  hasuraRequest,
  insertEscrowRecord,
  updateEscrowStatus,
  isEscrowTransitionError,
  isEscrowChangedError,
  isUniqueViolation,
  HasuraRequestError,
} from '../../services/hasura.js';
import { confirmTransactionWithRetry } from '../../services/stellar-confirm.js';
import { guardEscrowAction, sendConflict } from './transition-guard.js';
import {
  ConcurrentTransitionError,
  InvalidTransitionError,
  type EscrowActionName,
} from '../../domain/escrow-state.js';
import { asyncHandler } from '../../http/async-handler.js';
import { ApiError } from '../../http/api-error.js';

type EscrowAction =
  | 'initialize'
  | 'fund'
  | 'mark_milestone_completed'
  | 'approve_milestone'
  | 'release_funds'
  | 'dispute'
  | 'resolve_dispute';

type SendTransactionBody = {
  signedXdr?: string;
  action?: EscrowAction;
  contractId?: string;
  engagementId?: string;
  propertyId?: string;
  apartmentId?: string;
  senderAddress?: string;
  receiverAddress?: string;
  releaser?: string;
  amount?: number;
  milestoneId?: string;
  approver?: string;
  releaseSigner?: string;
  status?: string;
};

type SendTransactionTWResponse = {
  status: 'SUCCESS' | 'FAILED';
  message: string;
  contractId?: string;
  engagementId?: string;
  escrowId?: string;
  transactionHash?: string;
  txHash?: string;
};

const VALID_ACTIONS: EscrowAction[] = [
  'initialize',
  'fund',
  'mark_milestone_completed',
  'approve_milestone',
  'release_funds',
  'dispute',
  'resolve_dispute',
];

const REQUIRED_FIELDS: Record<EscrowAction, (keyof SendTransactionBody)[]> = {
  initialize: ['engagementId', 'senderAddress', 'receiverAddress', 'amount'],
  fund: ['amount'],
  mark_milestone_completed: ['milestoneId'],
  approve_milestone: ['milestoneId', 'approver'],
  release_funds: ['releaseSigner'],
  dispute: [],
  resolve_dispute: [],
};

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

export const sendTransactionHandler = asyncHandler(async (
  req: Request<{}, Record<string, unknown>, SendTransactionBody>,
  res: Response<Record<string, unknown>>,
) => {
  const body = req.body || {};
  const {
    signedXdr,
    action,
    contractId,
    engagementId,
    propertyId,
    apartmentId,
    senderAddress,
    receiverAddress,
    releaser,
    amount,
    milestoneId,
    approver,
    releaseSigner,
    status,
  } = body;

  if (!signedXdr || typeof signedXdr !== 'string') {
    throw new ApiError(400, 'INVALID_XDR', 'Missing or invalid signedXdr');
  }

  // ── Action-based transition-guarded flow ──────────────────────────────────
  if (action) {
    if (!VALID_ACTIONS.includes(action)) {
      throw new ApiError(400, 'INVALID_ACTION', `Invalid action. Must be one of: ${VALID_ACTIONS.join(', ')}`);
    }

    if (!isNonEmptyString(contractId)) {
      throw new ApiError(400, 'MISSING_CONTRACT_ID', 'Missing required fields: contractId');
    }

    const propId = propertyId || apartmentId;
    const missing = REQUIRED_FIELDS[action].filter((field) => {
      const value = body[field];
      if (field === 'engagementId' && engagementId) return false;
      return value == null || (field !== 'amount' && !isNonEmptyString(value));
    });

    if (action === 'initialize' && !propId) {
      missing.push('propertyId');
    }

    if (missing.length > 0) {
      throw new ApiError(400, 'MISSING_ACTION_FIELDS', `${action} action requires: contractId, ${missing.join(', ')}`);
    }

    if (action === 'initialize' || action === 'fund') {
      if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
        throw new ApiError(400, 'INVALID_AMOUNT', 'Invalid amount: must be a positive number.');
      }
    }

    // Pre-validate transition before Trustless Work call
    const conflict = await guardEscrowAction(res, action as EscrowActionName, contractId);
    if (conflict) return conflict;

    const result = await trustlessWorkRequest<SendTransactionTWResponse & Record<string, unknown>>(
      '/helper/send-transaction',
      {
        method: 'POST',
        body: { signedXdr },
      },
    );

    if (result.status !== 'SUCCESS') {
      throw new ApiError(502, 'TRUSTLESS_WORK_FAILED', 'TrustlessWork send-transaction failed.', { retryable: true });
    }

    const txHash = extractTransactionHash(result);
    if (txHash) {
      const ledgerConfirmation = await confirmTransactionWithRetry(txHash, { maxAttempts: 5, intervalMs: 2000 });

      if (ledgerConfirmation === 'failed') {
        return res.status(202).json({
          status: 'confirming',
          message: 'Stellar rejected the submitted transaction, so no escrow status change was applied.',
          contractId,
          transactionHash: txHash,
          ledgerStatus: 'failed',
        });
      }

      if (ledgerConfirmation !== 'success') {
        return res.status(202).json({
          status: 'confirming',
          message: 'Transaction accepted by Trustless Work; waiting for Stellar confirmation.',
          contractId,
          transactionHash: txHash,
          ledgerStatus: 'unknown',
        });
      }
    }

    const resolvedContractId = (result.contractId as string | undefined) ?? contractId;
    let insertedId: string | undefined;

    try {
      switch (action) {
        case 'initialize': {
          const effectiveReleaser = releaser || process.env.PLATFORM_STELLAR_ADDRESS || senderAddress!;
          await dbInitializeEscrow({
            contractId: resolvedContractId,
            engagementId: engagementId!,
            apartmentId: propId!,
            senderAddress: senderAddress!,
            receiverAddress: receiverAddress!,
            releaser: effectiveReleaser,
            amount: amount!,
          });
          const existing = await hasuraRequest<{ escrows: { id: string }[] }>(
            `query FindEscrowByContractId($contractId: String!) {
              escrows(where: { contract_id: { _eq: $contractId } }) { id }
            }`,
            { contractId: resolvedContractId },
          );
          if (existing.escrows.length > 0) {
            insertedId = existing.escrows[0].id;
          } else {
            const record = await insertEscrowRecord({
              contractId: resolvedContractId,
              engagementId: engagementId!,
              propertyId: propId!,
              senderAddress: senderAddress!,
              receiverAddress: receiverAddress!,
              amount: amount!,
              status: 'created',
            });
            insertedId = record.insert_escrows_one.id;
          }
          break;
        }
        case 'fund': {
          const hash = extractTransactionHash(result) ?? undefined;
          await dbFundEscrow(resolvedContractId, amount!, engagementId, hash);
          break;
        }
        case 'mark_milestone_completed': {
          const hash = extractTransactionHash(result) ?? undefined;
          await dbMarkMilestoneCompleted(resolvedContractId, milestoneId!, engagementId, hash);
          break;
        }
        case 'approve_milestone': {
          const hash = extractTransactionHash(result) ?? undefined;
          await dbApproveMilestone(resolvedContractId, milestoneId!, approver!, engagementId, hash);
          break;
        }
        case 'release_funds': {
          const hash = extractTransactionHash(result) ?? undefined;
          await dbReleaseFunds(resolvedContractId, releaseSigner!, engagementId, hash);
          break;
        }
        case 'dispute': {
          const hash = extractTransactionHash(result) ?? undefined;
          await dbDisputeEscrow(resolvedContractId, engagementId, hash);
          break;
        }
        case 'resolve_dispute': {
          const hash = extractTransactionHash(result) ?? undefined;
          await dbResolveDispute(resolvedContractId, engagementId, hash);
          break;
        }
      }
    } catch (error) {
      if (error instanceof ConcurrentTransitionError) {
        return res.status(409).json({
          error: 'Escrow changed. Refresh and retry',
          from: error.from,
          to: error.to,
        });
      }

      if (isUniqueViolation(error) || isEscrowChangedError(error)) {
        return res.status(409).json({
          error: 'Escrow changed. Refresh and retry',
        });
      }

      const conflict = sendConflict(res, error);
      if (conflict) return conflict;

      throw new ApiError(500, 'DB_SYNC_FAILED', 'Transaction confirmed on-chain, but database synchronization failed.', { retryable: true });
    }

    const responsePayload: Record<string, unknown> = {
      status: result.status,
      message: result.message,
      contractId: resolvedContractId,
      transactionHash: extractTransactionHash(result),
      engagementId,
    };

    if (action === 'initialize') {
      responsePayload.escrowId = insertedId;
    }

    return res.status(200).json(responsePayload);
  }

  // ── Pending-action hash binding flow (PR #459) ───────────────────────────
  const networkPassphrase = process.env.STELLAR_NETWORK_PASSPHRASE || Networks.TESTNET;
  const tx = TransactionBuilder.fromXDR(signedXdr, networkPassphrase);
  const txHash = tx.hash().toString('hex');

  const pending = await getPendingActionByHash(txHash);

  if (!pending) {
    throw new ApiError(404, 'UNKNOWN_TRANSACTION', 'Unknown transaction. Build it through SafeTrust first.');
  }

  // @ts-ignore
  if (pending.built_for_uid !== req.user?.uid) {
    throw new ApiError(403, 'FORBIDDEN_TRANSACTION', 'This transaction was built for another user.');
  }

  if (pending.status === "submitted" || pending.status === "confirmed") {
    return res.status(200).json({ txHash, status: pending.status }); // idempotent replay
  }

  if (new Date(pending.expires_at) < new Date()) {
    throw new ApiError(410, 'TRANSACTION_EXPIRED', 'Transaction expired. Build it again.');
  }

  const twResult = await trustlessWorkRequest('/helper/send-transaction', {
    method: 'POST',
    body: { signedXdr },
  });

  await markPendingActionSubmitted(pending.id);

  return res.status(200).json({ txHash, status: 'submitted', twResult });
});
