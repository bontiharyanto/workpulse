import type { ShiftTypeLiteral } from './create-shift.dto';

export interface ShiftResponseDto {
  id: string;
  companyId: string;
  name: string;
  type: ShiftTypeLiteral;
  startTime: string;
  endTime: string;
  graceMinutes: number;
  geofenceId: string | null;
  geofenceName: string | null;
  activeAssignments: number;
  createdAt: string;
  updatedAt: string;
}

export interface ShiftAssignmentResponseDto {
  id: string;
  userId: string;
  userFullName: string;
  shiftId: string;
  shiftName: string;
  effectiveFrom: string; // YYYY-MM-DD
  effectiveTo: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}
