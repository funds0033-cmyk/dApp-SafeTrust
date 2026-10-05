import type { Request, Response } from 'express';
import { trustlessWorkRequest } from '../../services/trustlesswork.js';
import { guardEscrowAction, sendConflict } from './transition-guard.js';
import { asyncHandler } from '../../http/async-handler.js';
import { ApiError } from '../../http/api-error.js';

type ApproveMilestoneBody = {
  contractId?: string;
  engagementId?: string;
  approver?: string;
  milestoneIndex?: number;
};

export const approveMilestoneHandler = asyncHandler(async (
  req: Request<{}, unknown, ApproveMilestoneBody>,
  res: Response,
) => {
  const { contractId, engagementId, approver, milestoneIndex = 0 } = req.body ?? {};

  if (!contractId || !engagementId || !approver) {
    throw new ApiError(400, 'MISSING_FIELDS', 'Missing required fields: contractId, engagementId, approver.');
  }
  if (!Number.isInteger(milestoneIndex) || milestoneIndex < 0) {
    throw new ApiError(400, 'INVALID_MILESTONE_INDEX', 'milestoneIndex must be a non-negative integer.');
  }

  const conflict = await guardEscrowAction(res, 'approve_milestone', contractId);
  if (conflict) return conflict;

  const result = await trustlessWorkRequest<{ unsignedXdr?: string; unsignedTransaction?: string; txHash?: string }>(
    '/escrow/single-release/approve-milestone',
    {
      method: 'POST',
      body: { contractId, approver, milestoneIndex: String(milestoneIndex) },
    },
  );
  const unsignedXdr = result.unsignedXdr ?? result.unsignedTransaction;
  if (!unsignedXdr) {
    throw new ApiError(502, 'TRUSTLESS_WORK_EMPTY_RESPONSE', 'Trustless Work returned no unsigned transaction.', { retryable: true });
  }
  return res.status(200).json({ unsignedXdr, txHash: result.txHash ?? '', contractId, engagementId });
});
