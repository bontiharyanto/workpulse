import type { LeaveKindLiteral } from './create-leave-type.dto';

export interface AdminLeaveTypeDto {
  id: string;
  companyId: string;
  code: string;
  name: string;
  kind: LeaveKindLiteral;
  defaultAnnualQuota: number;
  carryOverMax: number;
  requiresAttachment: boolean;
  balanceCount: number;
  createdAt: string;
  updatedAt: string;
}
