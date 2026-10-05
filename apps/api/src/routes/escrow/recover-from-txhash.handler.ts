import type { Request, Response } from 'express';
import { trustlessWorkRequest } from '../../services/trustlesswork.js';
import { updateEscrowStatusByContractId } from '../../services/hasura.js';
import { ApiError } from '../../http/api-error.js';
import { asyncHandler } from '../../http/async-handler.js';

type RecoverAction =
  | 'initialize'
  | 'fund'
  | 'approve_milestone'
  | 'release_funds'
  | 'dispute'
  | 'resolve_dispute';

type RecoverRequestBody = {
  txHash?: string;
  action?: RecoverAction;
  contractId?: string;
  engagementId?: string;
  apartmentId?: string;
  senderAddress?: string;
  receiverAddress?: string;
  releaser?: string;
  amount?: number;
  milestoneId?: string;
  approver?: string;
  releaseSigner?: string;
};

const VALID_ACTIONS: RecoverAction[] = [
  'initialize',
  'fund',
  'approve_milestone',
  'release_funds',
  'dispute',
  'resolve_dispute',
];

const ACTION_STATUS: Record<RecoverAction, string> = {
  // initialize completed on-chain → the escrow is live and awaiting funding
  // (deploy's pending_signature is normalized to created).
  initialize: 'created',
  fund: 'funded',
  approve_milestone: 'funded',
  release_funds: 'completed',
  dispute: 'disputed',
  resolve_dispute: 'resolved',
};

const REQUIRED_FIELDS: Record<RecoverAction, (keyof RecoverRequestBody)[]> = {
  initialize: ['engagementId', 'apartmentId', 'senderAddress', 'receiverAddress', 'releaser', 'amount'],
  fund: ['amount'],
  approve_milestone: ['milestoneId', 'approver'],
  release_funds: ['releaseSigner'],
  dispute: [],
  resolve_dispute: [],
};

type RecoverResponse = {
  recovered: boolean;
  action: RecoverAction;
  contractId: string;
  txHash: string;
  status: string;
};

export const recoverFromTxhashHandler = asyncHandler(async (
  req: Request<{}, RecoverResponse, RecoverRequestBody>,
  res: Response<RecoverResponse>,
) => {
  const { txHash, action, contractId } = req.body || {};

  if (!txHash) {
    throw new ApiError(400, 'MISSING_TX_HASH', 'Missing required field: txHash');
  }
  if (!action) {
    throw new ApiError(400, 'MISSING_ACTION', 'Missing required field: action');
  }
  if (!VALID_ACTIONS.includes(action)) {
    throw new ApiError(400, 'INVALID_ACTION', `Invalid action. Must be one of: ${VALID_ACTIONS.join(', ')}`);
  }
  if (!contractId) {
    throw new ApiError(400, 'MISSING_CONTRACT_ID', 'Missing required field: contractId');
  }

  const missing = REQUIRED_FIELDS[action].filter((field) => {
    const value = req.body[field];
    if (value == null) return true;
    if (field === 'amount') return typeof value !== 'number' || !Number.isFinite(value) || value <= 0;
    return typeof value !== 'string' || value.trim().length === 0;
  });
  if (missing.length > 0) {
    throw new ApiError(400, 'MISSING_ACTION_FIELDS', `${action} action requires: contractId, ${missing.join(', ')}`);
  }

  // Verify the transaction exists on-chain via TW indexer — throws TrustlessWorkRequestError
  // which errorMiddleware maps to TRUSTLESS_WORK_* codes automatically
  await trustlessWorkRequest('/indexer/update-from-txHash', {
    method: 'POST',
    body: { txHash },
  });

  const status = ACTION_STATUS[action];
  const result = await updateEscrowStatusByContractId(contractId, status);

  if (result.update_escrows.affected_rows === 0) {
    throw new ApiError(404, 'ESCROW_NOT_FOUND', `No escrow record found for contractId: ${contractId}`);
  }

  return res.status(200).json({ recovered: true, action, contractId, txHash, status });
});
