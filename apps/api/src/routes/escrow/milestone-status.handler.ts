import type { Request, Response } from 'express';
import { trustlessWorkRequest } from '../../services/trustlesswork.js';
import { guardEscrowAction, sendConflict } from './transition-guard.js';
import { asyncHandler } from '../../http/async-handler.js';
import { ApiError } from '../../http/api-error.js';

type MilestoneStatusRequestBody = {
  contractId?: string;
  serviceProvider?: string;
  engagementId?: string;
  milestoneIndex?: number;
  newStatus?: string;
  newEvidence?: string;
};

type ChangeMilestoneStatusTWResponse = {
  unsignedXdr?: string;
  unsignedTransaction?: string;
  txHash?: string;
};

type MilestoneStatusResponse = {
  unsignedXdr: string;
  txHash: string;
  contractId: string;
  engagementId: string;
  status: string;
};

export const milestoneStatusHandler = asyncHandler(async (
  req: Request<{}, MilestoneStatusResponse, MilestoneStatusRequestBody>,
  res: Response<MilestoneStatusResponse>,
) => {
  const { contractId, serviceProvider, engagementId, milestoneIndex, newStatus, newEvidence } = req.body || {};

  if (!contractId || !serviceProvider || !engagementId) {
    throw new ApiError(400, 'MISSING_FIELDS', 'Missing required fields: contractId, serviceProvider, engagementId.');
  }

  const validStatuses = ['completed'];
  const resolvedStatus = newStatus ?? 'completed';
  if (!validStatuses.includes(resolvedStatus)) {
    throw new ApiError(400, 'INVALID_STATUS', `Invalid newStatus: must be one of ${validStatuses.join(', ')}.`);
  }

  const resolvedIndex = milestoneIndex ?? 0;
  if (!Number.isInteger(resolvedIndex) || resolvedIndex < 0) {
    throw new ApiError(400, 'INVALID_MILESTONE_INDEX', 'Invalid milestoneIndex: must be a non-negative integer.');
  }

  const conflict = await guardEscrowAction(res, 'mark_milestone_completed', contractId);
  if (conflict) return conflict;

  const result = await trustlessWorkRequest<ChangeMilestoneStatusTWResponse>(
    '/escrow/single-release/change-milestone-status',
    {
      method: 'POST',
      body: {
        contractId,
        serviceProvider,
        milestoneIndex: String(resolvedIndex),
        newStatus: resolvedStatus,
        newEvidence: newEvidence ?? '',
      },
    },
  );

  const unsignedXdr = result.unsignedXdr ?? result.unsignedTransaction;
  if (!unsignedXdr) {
    throw new ApiError(502, 'TRUSTLESS_WORK_EMPTY_RESPONSE', 'TrustlessWork milestone-status request returned no unsigned transaction.', { retryable: true });
  }

  return res.status(200).json({
    unsignedXdr,
    txHash: result.txHash ?? '',
    contractId,
    engagementId,
    // A service-provider completion is not tenant approval. The aggregate
    // escrow moves to milestone_approved only after approve-milestone is
    // signed by the approver and submitted.
    status: 'funded',
  });
});
