import type {
  AdminLeaveType,
  AdminUser,
  AttendanceCorrection,
  AttendanceCorrectionDecision,
  AttendanceCorrectionInput,
  AttendanceHistoryQuery,
  AuditLogFilters,
  AuditLogPage,
  BacklogSummary,
  AttendanceMonthlySummary,
  AttendanceRecord,
  AttendanceReportRequest,
  ClockInInput,
  ClockOutInput,
  CompanyDashboardSnapshot,
  CreateAbsenceInput,
  CreateAbsenceResponse,
  TeamMemberDailyRow,
  TeamSummaryResponse,
  CompanyConfig,
  CompanyConfigUpdateInput,
  CreateDepartmentInput,
  BulkImportHolidaysInput,
  BulkImportHolidaysResponse,
  CreateGeofenceInput,
  CreateHolidayInput,
  CreateLeaveTypeInput,
  CreateShiftAssignmentInput,
  CreateShiftInput,
  CreateUserInput,
  Department,
  EndShiftAssignmentInput,
  ErrorCode,
  Geofence,
  Holiday,
  LeaveApprovalInput,
  LeaveBalance,
  LeaveRequest,
  LeaveRequestInput,
  LeaveSummaryReportRequest,
  ListUsersQuery,
  CompanyAdmin,
  CompanyBootstrap,
  CreateCompanyInput,
  DataExportDownloadResponse,
  DataErasureAdminListResponse,
  DataErasureAdminRequestRow,
  DataErasureListResponse,
  DataErasureRequestRow,
  DataExportListResponse,
  DataExportRequestRow,
  ListCompaniesQuery,
  ListCompaniesResponse,
  UpdateCompanyInput,
  ChangePasswordInput,
  ChangePasswordResponse,
  ForgotPasswordInput,
  ForgotPasswordResponse,
  LoginInput,
  LoginResponse,
  MfaBackupCodesInput,
  MfaBackupCodesResponse,
  MfaDisableInput,
  MfaEnrollConfirmInput,
  MfaEnrollConfirmResponse,
  MfaEnrollStartResponse,
  MfaStatus,
  MfaVerifyInput,
  MfaVerifyResponse,
  Notification,
  NotificationPage,
  NotificationPreferenceRow,
  ResetPasswordInput,
  ResetPasswordResponse,
  ResetScannerCursorInput,
  ResetScannerCursorResponse,
  Session,
  SessionListResponse,
  SessionRevokeOthersResponse,
  UpdateNotificationPreferencesInput,
  UpdateRetentionPolicyInput,
  UpdateSecurityPolicyInput,
  UserConsentDto,
  UserConsentListResponseDto,
  OvertimeDecisionInput,
  OvertimeReportRequest,
  OvertimeRequest,
  OvertimeRequestInput,
  PresignPutRequest,
  PresignPutResponse,
  PrivacyPolicyDto,
  PrivacyPolicyListResponseDto,
  PublishPolicyInput,
  RefreshResponse,
  RetentionPolicyDto,
  SecurityPolicyDto,
  RetentionAuditReportDto,
  RetentionAuditListResponseDto,
  RegenerateRetentionAuditInput,
  RetentionAuditStatus,
  TenantUsageSnapshotDto,
  TenantUsageListResponseDto,
  RegenerateTenantUsageInput,
  RopaActivityDetail,
  RopaActivityListItem,
  RopaVersionResponse,
  CreateRopaActivityInput,
  UpdateRopaVersionInput,
  SeedRopaResponse,
  DpiaAssessmentListItem,
  DpiaAssessmentResponse,
  CreateDpiaAssessmentInput,
  UpdateDpiaAssessmentInput,
  CreateDpiaRiskItemInput,
  UpdateDpiaRiskItemInput,
  ReportScheduleResponse,
  ReportDeliveryResponse,
  ReportRegistryEntry,
  CreateReportScheduleInput,
  UpdateReportScheduleInput,
  CustomReportCatalogue,
  CustomReportDefinition,
  CustomReportResult,
  SavedReportResponse,
  CreateSavedReportInput,
  UpdateSavedReportInput,
  BreachIncidentResponse,
  BreachIncidentListItem,
  CreateBreachIncidentInput,
  UpdateBreachIncidentInput,
  NotifyAuthorityInput,
  NotifySubjectsInput,
  CloseBreachInput,
  AppendBreachNoteInput,
  Shift,
  ShiftAssignment,
  UserWithoutShift,
  TimesheetConfigDto,
  TimesheetListDto,
  TimesheetPeriodListDto,
  TimesheetSummaryDto,
  TimesheetViewDto,
  TimesheetStatus,
  GenerateTimesheetInput,
  GenerateTimesheetResponse,
  UpdateTimesheetConfigInput,
  DecideTimesheetInput,
  ReopenTimesheetInput,
  ReopenTimesheetResponse,
  ExportTimesheetInput,
  TimesheetExportListDto,
  CreateExportShareInput,
  ExportShareListDto,
  ExportShareUrl,
  CreateVendorInput,
  UpdateVendorInput,
  MarkVendorReviewedInput,
  TerminateVendorInput,
  LinkRopaInput,
  ListVendorsQuery,
  ListVendorsResponseDto,
  VendorDetailDto,
  CreateWebhookInput,
  UpdateWebhookInput,
  WebhookDeliveryListDto,
  WebhookEndpointListDto,
  WebhookEndpointRow,
  WebhookEndpointWithSecret,
  UpdateDepartmentInput,
  UpdateGeofenceInput,
  UpdateHolidayInput,
  UpdateLeaveTypeInput,
  UpdateShiftInput,
  UpdateUserInput,
  UnreadCountResponse,
  UserCredentialResponse,
  AnalyticsMetricKey,
  AnalyticsWindowDays,
  DashboardResponse,
  TimeseriesResponse,
} from '@workpulse/shared-types';

import { authStore, computeExpiryEpoch } from './auth-store';

export interface ApiErrorPayload {
  statusCode: number;
  code: ErrorCode | string;
  message: string;
  details?: unknown;
  path: string;
  timestamp: string;
}

export class ApiError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details: unknown;

  constructor(payload: ApiErrorPayload) {
    super(payload.message);
    this.name = 'ApiError';
    this.statusCode = payload.statusCode;
    this.code = payload.code;
    this.details = payload.details;
  }
}

interface RequestOptions extends Omit<RequestInit, 'body'> {
  json?: unknown;
  skipAuth?: boolean;
  _retried?: boolean;
}

const baseUrl = (): string => process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

let refreshInFlight: Promise<string | null> | null = null;

async function tryRefreshAccessToken(): Promise<string | null> {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    try {
      const res = await fetch(`${baseUrl()}/api/v1/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) return null;
      const body = (await res.json()) as RefreshResponse;
      authStore.set({
        accessToken: body.accessToken,
        expiresAt: computeExpiryEpoch(body.accessTokenExpiresIn),
      });
      return body.accessToken;
    } catch {
      return null;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { json, skipAuth, _retried, headers, ...rest } = options;

  const finalHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(headers as Record<string, string> | undefined),
  };

  if (!skipAuth) {
    const { accessToken, expiresAt } = authStore.get();
    let token = accessToken;
    if (!token || (expiresAt && expiresAt <= Date.now())) {
      token = await tryRefreshAccessToken();
    }
    if (token) finalHeaders.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(`${baseUrl()}/api/v1${path}`, {
    ...rest,
    headers: finalHeaders,
    body: json === undefined ? undefined : JSON.stringify(json),
    credentials: 'include',
  });

  const text = await res.text();
  const parsed = text ? (JSON.parse(text) as unknown) : null;

  if (res.status === 401 && !skipAuth && !_retried) {
    const refreshed = await tryRefreshAccessToken();
    if (refreshed) {
      return apiRequest<T>(path, { ...options, _retried: true });
    }
    authStore.clear();
  }

  if (!res.ok) {
    throw new ApiError(parsed as ApiErrorPayload);
  }
  return parsed as T;
}

export const authApi = {
  login: (body: LoginInput): Promise<LoginResponse> =>
    apiRequest<LoginResponse>('/auth/login', { method: 'POST', json: body, skipAuth: true }),
  refresh: (): Promise<RefreshResponse> =>
    apiRequest<RefreshResponse>('/auth/refresh', { method: 'POST', skipAuth: true }),
  logout: (): Promise<void> => apiRequest<void>('/auth/logout', { method: 'POST', skipAuth: true }),
  me: (): Promise<LoginResponse['user']> =>
    apiRequest<LoginResponse['user']>('/auth/me', { method: 'GET' }),
  forgotPassword: (body: ForgotPasswordInput): Promise<ForgotPasswordResponse> =>
    apiRequest<ForgotPasswordResponse>('/auth/forgot-password', {
      method: 'POST',
      json: body,
      skipAuth: true,
    }),
  resetPassword: (body: ResetPasswordInput): Promise<ResetPasswordResponse> =>
    apiRequest<ResetPasswordResponse>('/auth/reset-password', {
      method: 'POST',
      json: body,
      skipAuth: true,
    }),
  changePassword: (body: ChangePasswordInput): Promise<ChangePasswordResponse> =>
    apiRequest<ChangePasswordResponse>('/auth/change-password', {
      method: 'POST',
      json: body,
    }),
};

/**
 * MFA sub-API. All endpoints are gated by the same auth flow as the
 * rest of `authApi`. `verify` is reachable with a pre-MFA access token
 * (`mfaPassed=false`); the others need a fully-verified session, EXCEPT
 * `enrollStart` / `enrollConfirm` / `status` which are also whitelisted
 * for HR/SA users mid-enrollment.
 */
export const mfaApi = {
  status: (): Promise<MfaStatus> => apiRequest<MfaStatus>('/auth/mfa/status', { method: 'GET' }),
  enrollStart: (): Promise<MfaEnrollStartResponse> =>
    apiRequest<MfaEnrollStartResponse>('/auth/mfa/enroll/start', { method: 'POST' }),
  enrollConfirm: (body: MfaEnrollConfirmInput): Promise<MfaEnrollConfirmResponse> =>
    apiRequest<MfaEnrollConfirmResponse>('/auth/mfa/enroll/confirm', {
      method: 'POST',
      json: body,
    }),
  verify: (body: MfaVerifyInput): Promise<MfaVerifyResponse> =>
    apiRequest<MfaVerifyResponse>('/auth/mfa/verify', {
      method: 'POST',
      json: body,
    }),
  regenerateBackupCodes: (body: MfaBackupCodesInput): Promise<MfaBackupCodesResponse> =>
    apiRequest<MfaBackupCodesResponse>('/auth/mfa/backup-codes/regenerate', {
      method: 'POST',
      json: body,
    }),
  disable: (body: MfaDisableInput): Promise<void> =>
    apiRequest<void>('/auth/mfa', { method: 'DELETE', json: body }),
};

/**
 * Session management surface — self-service device revocation from
 * `/settings/security`. Every call is scoped to the caller server-side;
 * there is no cross-user variant here. `revoke` returns 204 on
 * success — `revokeOthers` returns a count so the FE can render a
 * "X sesi lain berhasil dilogout" toast.
 */
export const sessionsApi = {
  list: (): Promise<Session[]> =>
    apiRequest<SessionListResponse>('/auth/sessions', { method: 'GET' }).then(
      (res) => res.sessions,
    ),
  revoke: (id: string): Promise<void> =>
    apiRequest<void>(`/auth/sessions/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),
  revokeOthers: (): Promise<SessionRevokeOthersResponse> =>
    apiRequest<SessionRevokeOthersResponse>('/auth/sessions/revoke-others', {
      method: 'POST',
    }),
};

/**
 * DSAR / data-portability surface (Fase 31a). All calls are scoped
 * to the authenticated user; there is no admin variant.
 */
export const dataExportApi = {
  create: (): Promise<DataExportRequestRow> =>
    apiRequest<DataExportRequestRow>('/me/data-export', { method: 'POST' }),
  list: (): Promise<DataExportRequestRow[]> =>
    apiRequest<DataExportListResponse>('/me/data-export', { method: 'GET' }).then(
      (r) => r.requests,
    ),
  downloadUrl: (id: string): Promise<DataExportDownloadResponse> =>
    apiRequest<DataExportDownloadResponse>(`/me/data-export/${encodeURIComponent(id)}/download`, {
      method: 'GET',
    }),
};

export const dataErasureApi = {
  create: (body: { reason?: string }): Promise<DataErasureRequestRow> =>
    apiRequest<DataErasureRequestRow>('/me/data-erasure', {
      method: 'POST',
      json: body,
    }),
  list: (): Promise<DataErasureRequestRow[]> =>
    apiRequest<DataErasureListResponse>('/me/data-erasure', {
      method: 'GET',
    }).then((r) => r.requests),
  cancel: (id: string): Promise<DataErasureRequestRow> =>
    apiRequest<DataErasureRequestRow>(`/me/data-erasure/${encodeURIComponent(id)}/cancel`, {
      method: 'POST',
    }),
};

export const retentionApi = {
  get: (): Promise<RetentionPolicyDto> =>
    apiRequest<RetentionPolicyDto>('/admin/privacy/retention', {
      method: 'GET',
    }),
  update: (body: UpdateRetentionPolicyInput): Promise<RetentionPolicyDto> =>
    apiRequest<RetentionPolicyDto>('/admin/privacy/retention', {
      method: 'PUT',
      json: body,
    }),
};

export const securityPolicyApi = {
  get: (): Promise<SecurityPolicyDto> =>
    apiRequest<SecurityPolicyDto>('/admin/security/policy', {
      method: 'GET',
    }),
  update: (body: UpdateSecurityPolicyInput): Promise<SecurityPolicyDto> =>
    apiRequest<SecurityPolicyDto>('/admin/security/policy', {
      method: 'PATCH',
      json: body,
    }),
};

export const retentionAuditApi = {
  list: (
    opts: {
      status?: RetentionAuditStatus;
      page?: number;
      pageSize?: number;
    } = {},
  ): Promise<RetentionAuditListResponseDto> => {
    const params = new URLSearchParams();
    if (opts.status) params.set('status', opts.status);
    if (opts.page) params.set('page', String(opts.page));
    if (opts.pageSize) params.set('pageSize', String(opts.pageSize));
    const query = params.toString();
    return apiRequest<RetentionAuditListResponseDto>(
      `/admin/privacy/retention/audit-reports${query ? `?${query}` : ''}`,
      { method: 'GET' },
    );
  },
  latest: (): Promise<RetentionAuditReportDto | null> =>
    apiRequest<RetentionAuditReportDto | null>('/admin/privacy/retention/audit-reports/latest', {
      method: 'GET',
    }),
  detail: (id: string): Promise<RetentionAuditReportDto> =>
    apiRequest<RetentionAuditReportDto>(`/admin/privacy/retention/audit-reports/${id}`, {
      method: 'GET',
    }),
  regenerate: (body: RegenerateRetentionAuditInput): Promise<RetentionAuditReportDto> =>
    apiRequest<RetentionAuditReportDto>('/admin/privacy/retention/audit-reports/regenerate', {
      method: 'POST',
      json: body,
    }),
};

export const tenantUsageApi = {
  list: (
    opts: {
      companyId?: string;
      page?: number;
      pageSize?: number;
    } = {},
  ): Promise<TenantUsageListResponseDto> => {
    const params = new URLSearchParams();
    if (opts.companyId) params.set('companyId', opts.companyId);
    if (opts.page) params.set('page', String(opts.page));
    if (opts.pageSize) params.set('pageSize', String(opts.pageSize));
    const query = params.toString();
    return apiRequest<TenantUsageListResponseDto>(
      `/admin/usage/snapshots${query ? `?${query}` : ''}`,
      { method: 'GET' },
    );
  },
  currentMonth: (): Promise<TenantUsageSnapshotDto | null> =>
    apiRequest<TenantUsageSnapshotDto | null>('/admin/usage/current-month', {
      method: 'GET',
    }),
  detail: (id: string): Promise<TenantUsageSnapshotDto> =>
    apiRequest<TenantUsageSnapshotDto>(`/admin/usage/snapshots/${id}`, {
      method: 'GET',
    }),
  regenerate: (body: RegenerateTenantUsageInput): Promise<TenantUsageSnapshotDto> =>
    apiRequest<TenantUsageSnapshotDto>('/admin/usage/regenerate', {
      method: 'POST',
      json: body,
    }),
};

export const vendorProcessorApi = {
  list: (query: ListVendorsQuery = {}): Promise<ListVendorsResponseDto> => {
    const params = new URLSearchParams();
    if (query.status) params.set('status', query.status);
    if (query.category) params.set('category', query.category);
    if (query.cursor) params.set('cursor', query.cursor);
    if (query.limit) params.set('limit', String(query.limit));
    const qs = params.toString();
    return apiRequest<ListVendorsResponseDto>(`/admin/privacy/vendors${qs ? `?${qs}` : ''}`, {
      method: 'GET',
    });
  },
  detail: (id: string): Promise<VendorDetailDto> =>
    apiRequest<VendorDetailDto>(`/admin/privacy/vendors/${id}`, {
      method: 'GET',
    }),
  create: (body: CreateVendorInput): Promise<VendorDetailDto> =>
    apiRequest<VendorDetailDto>('/admin/privacy/vendors', {
      method: 'POST',
      json: body,
    }),
  update: (id: string, body: UpdateVendorInput): Promise<VendorDetailDto> =>
    apiRequest<VendorDetailDto>(`/admin/privacy/vendors/${id}`, {
      method: 'PATCH',
      json: body,
    }),
  markReviewed: (id: string, body: MarkVendorReviewedInput): Promise<VendorDetailDto> =>
    apiRequest<VendorDetailDto>(`/admin/privacy/vendors/${id}/mark-reviewed`, {
      method: 'POST',
      json: body,
    }),
  terminate: (id: string, body: TerminateVendorInput): Promise<VendorDetailDto> =>
    apiRequest<VendorDetailDto>(`/admin/privacy/vendors/${id}/terminate`, {
      method: 'POST',
      json: body,
    }),
  linkRopa: (id: string, body: LinkRopaInput): Promise<VendorDetailDto> =>
    apiRequest<VendorDetailDto>(`/admin/privacy/vendors/${id}/ropa-links`, {
      method: 'POST',
      json: body,
    }),
  unlinkRopa: (id: string, linkId: string): Promise<VendorDetailDto> =>
    apiRequest<VendorDetailDto>(`/admin/privacy/vendors/${id}/ropa-links/${linkId}`, {
      method: 'DELETE',
    }),
};

export const privacyPolicyAdminApi = {
  list: (): Promise<PrivacyPolicyDto[]> =>
    apiRequest<PrivacyPolicyListResponseDto>('/admin/privacy/policies', {
      method: 'GET',
    }).then((r) => r.items),
  publish: (body: PublishPolicyInput): Promise<PrivacyPolicyDto> =>
    apiRequest<PrivacyPolicyDto>('/admin/privacy/policies', {
      method: 'POST',
      json: body,
    }),
};

export const consentApi = {
  current: (): Promise<PrivacyPolicyDto | null> =>
    apiRequest<PrivacyPolicyDto | null>('/me/consent/current', {
      method: 'GET',
    }),
  accept: (policyId: string): Promise<UserConsentDto> =>
    apiRequest<UserConsentDto>('/me/consent', {
      method: 'POST',
      json: { policyId },
    }),
  history: (): Promise<UserConsentDto[]> =>
    apiRequest<UserConsentListResponseDto>('/me/consent/history', {
      method: 'GET',
    }).then((r) => r.items),
};

export const timesheetConfigApi = {
  get: (): Promise<TimesheetConfigDto> =>
    apiRequest<TimesheetConfigDto>('/admin/timesheet/config', { method: 'GET' }),
  update: (body: UpdateTimesheetConfigInput): Promise<TimesheetConfigDto> =>
    apiRequest<TimesheetConfigDto>('/admin/timesheet/config', {
      method: 'PUT',
      json: body,
    }),
};

export const timesheetSelfApi = {
  current: (): Promise<TimesheetViewDto | null> =>
    apiRequest<TimesheetViewDto | null>('/me/timesheet/current', {
      method: 'GET',
    }),
  list: (limit = 12): Promise<TimesheetSummaryDto[]> =>
    apiRequest<TimesheetSummaryDto[]>(`/me/timesheet?limit=${encodeURIComponent(limit)}`, {
      method: 'GET',
    }),
  detail: (id: string): Promise<TimesheetViewDto> =>
    apiRequest<TimesheetViewDto>(`/me/timesheet/${encodeURIComponent(id)}`, {
      method: 'GET',
    }),
  submit: (id: string): Promise<void> =>
    apiRequest<void>(`/me/timesheet/${encodeURIComponent(id)}/submit`, {
      method: 'POST',
      json: {},
    }),
};

export const timesheetAdminApi = {
  periods: (): Promise<TimesheetPeriodListDto> =>
    apiRequest<TimesheetPeriodListDto>('/admin/timesheet/periods', {
      method: 'GET',
    }),
  list: (
    filter: {
      periodId?: string;
      userId?: string;
      departmentId?: string;
      status?: TimesheetStatus;
      limit?: number;
      offset?: number;
    } = {},
  ): Promise<TimesheetListDto> => {
    const params = new URLSearchParams();
    if (filter.periodId) params.set('periodId', filter.periodId);
    if (filter.userId) params.set('userId', filter.userId);
    if (filter.departmentId) params.set('departmentId', filter.departmentId);
    if (filter.status) params.set('status', filter.status);
    if (filter.limit !== undefined) params.set('limit', String(filter.limit));
    if (filter.offset !== undefined) params.set('offset', String(filter.offset));
    const qs = params.toString();
    return apiRequest<TimesheetListDto>(`/admin/timesheet${qs ? `?${qs}` : ''}`, { method: 'GET' });
  },
  detail: (id: string): Promise<TimesheetViewDto> =>
    apiRequest<TimesheetViewDto>(`/admin/timesheet/${encodeURIComponent(id)}`, {
      method: 'GET',
    }),
  generate: (body: GenerateTimesheetInput = {}): Promise<GenerateTimesheetResponse> =>
    apiRequest<GenerateTimesheetResponse>('/admin/timesheet/generate', {
      method: 'POST',
      json: body,
    }),
  decide: (id: string, body: DecideTimesheetInput): Promise<void> =>
    apiRequest<void>(`/admin/timesheet/${encodeURIComponent(id)}/decide`, {
      method: 'POST',
      json: body,
    }),
  reopen: (id: string, body: ReopenTimesheetInput): Promise<ReopenTimesheetResponse> =>
    apiRequest<ReopenTimesheetResponse>(`/admin/timesheet/${encodeURIComponent(id)}/reopen`, {
      method: 'POST',
      json: body,
    }),
};

export const dataErasureAdminApi = {
  listPending: (): Promise<DataErasureAdminRequestRow[]> =>
    apiRequest<DataErasureAdminListResponse>('/admin/data-erasure/pending', {
      method: 'GET',
    }).then((r) => r.requests),
  listAll: (): Promise<DataErasureAdminRequestRow[]> =>
    apiRequest<DataErasureAdminListResponse>('/admin/data-erasure', {
      method: 'GET',
    }).then((r) => r.requests),
  approve: (id: string, body: { note?: string } = {}): Promise<DataErasureAdminRequestRow> =>
    apiRequest<DataErasureAdminRequestRow>(
      `/admin/data-erasure/${encodeURIComponent(id)}/approve`,
      { method: 'POST', json: body },
    ),
  reject: (id: string, body: { note: string }): Promise<DataErasureAdminRequestRow> =>
    apiRequest<DataErasureAdminRequestRow>(`/admin/data-erasure/${encodeURIComponent(id)}/reject`, {
      method: 'POST',
      json: body,
    }),
};

export const attendanceApi = {
  clockIn: (body: ClockInInput): Promise<AttendanceRecord> =>
    apiRequest<AttendanceRecord>('/attendance/clock-in', { method: 'POST', json: body }),
  clockOut: (body: ClockOutInput): Promise<AttendanceRecord> =>
    apiRequest<AttendanceRecord>('/attendance/clock-out', { method: 'POST', json: body }),
  today: (): Promise<AttendanceRecord | null> =>
    apiRequest<AttendanceRecord | null>('/attendance/me/today', { method: 'GET' }),
  history: (q: AttendanceHistoryQuery = {}): Promise<AttendanceRecord[]> => {
    const params = new URLSearchParams();
    if (q.from) params.set('from', q.from);
    if (q.to) params.set('to', q.to);
    if (q.limit) params.set('limit', String(q.limit));
    const suffix = params.toString() ? `?${params.toString()}` : '';
    return apiRequest<AttendanceRecord[]>(`/attendance/me/history${suffix}`, { method: 'GET' });
  },
  monthlySummary: (
    q: { year?: number; month?: number } = {},
  ): Promise<AttendanceMonthlySummary> => {
    const params = new URLSearchParams();
    if (q.year) params.set('year', String(q.year));
    if (q.month) params.set('month', String(q.month));
    const suffix = params.toString() ? `?${params.toString()}` : '';
    return apiRequest<AttendanceMonthlySummary>(`/attendance/me/summary${suffix}`, {
      method: 'GET',
    });
  },
  teamToday: (q: { date?: string } = {}): Promise<TeamMemberDailyRow[]> => {
    const params = new URLSearchParams();
    if (q.date) params.set('date', q.date);
    const suffix = params.toString() ? `?${params.toString()}` : '';
    return apiRequest<TeamMemberDailyRow[]>(`/attendance/team/today${suffix}`, {
      method: 'GET',
    });
  },
  teamSummary: (q: { from?: string; to?: string } = {}): Promise<TeamSummaryResponse> => {
    const params = new URLSearchParams();
    if (q.from) params.set('from', q.from);
    if (q.to) params.set('to', q.to);
    const suffix = params.toString() ? `?${params.toString()}` : '';
    return apiRequest<TeamSummaryResponse>(`/attendance/team/summary${suffix}`, {
      method: 'GET',
    });
  },
  dashboard: (q: { date?: string } = {}): Promise<CompanyDashboardSnapshot> => {
    const params = new URLSearchParams();
    if (q.date) params.set('date', q.date);
    const suffix = params.toString() ? `?${params.toString()}` : '';
    return apiRequest<CompanyDashboardSnapshot>(`/attendance/dashboard${suffix}`, {
      method: 'GET',
    });
  },
  markAbsent: (body: CreateAbsenceInput): Promise<CreateAbsenceResponse> =>
    apiRequest<CreateAbsenceResponse>('/attendance/absence', {
      method: 'POST',
      json: body,
    }),
  deleteAbsence: (id: string): Promise<void> =>
    apiRequest<void>(`/attendance/absence/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),
  /**
   * SUPER_ADMIN ops: reset the absence-scanner cursor for the caller's
   * tenant. See ADR-0010 §Follow-ups for the operational context.
   */
  resetScannerCursor: (body: ResetScannerCursorInput = {}): Promise<ResetScannerCursorResponse> =>
    apiRequest<ResetScannerCursorResponse>('/attendance/scanner/reset-cursor', {
      method: 'POST',
      json: body,
    }),
};

export const attendanceCorrectionsApi = {
  submit: (body: AttendanceCorrectionInput): Promise<AttendanceCorrection> =>
    apiRequest<AttendanceCorrection>('/attendance/corrections', {
      method: 'POST',
      json: body,
    }),
  listMine: (): Promise<AttendanceCorrection[]> =>
    apiRequest<AttendanceCorrection[]>('/attendance/corrections/mine', {
      method: 'GET',
    }),
  listPendingApprovals: (): Promise<AttendanceCorrection[]> =>
    apiRequest<AttendanceCorrection[]>('/attendance/corrections/approvals/pending', {
      method: 'GET',
    }),
  decide: (id: string, body: AttendanceCorrectionDecision): Promise<AttendanceCorrection> =>
    apiRequest<AttendanceCorrection>(`/attendance/corrections/${encodeURIComponent(id)}/decision`, {
      method: 'POST',
      json: body,
    }),
  cancel: (id: string): Promise<AttendanceCorrection> =>
    apiRequest<AttendanceCorrection>(`/attendance/corrections/${encodeURIComponent(id)}/cancel`, {
      method: 'POST',
    }),
};

export const leaveApi = {
  submit: (body: LeaveRequestInput): Promise<LeaveRequest> =>
    apiRequest<LeaveRequest>('/leave', { method: 'POST', json: body }),
  listMine: (year?: number): Promise<LeaveRequest[]> =>
    apiRequest<LeaveRequest[]>(`/leave/mine${year ? `?year=${year}` : ''}`, { method: 'GET' }),
  balance: (year?: number): Promise<LeaveBalance[]> =>
    apiRequest<LeaveBalance[]>(`/leave/balance${year ? `?year=${year}` : ''}`, { method: 'GET' }),
  listPendingApprovals: (): Promise<LeaveRequest[]> =>
    apiRequest<LeaveRequest[]>('/leave/approvals/pending', { method: 'GET' }),
  decide: (id: string, body: LeaveApprovalInput): Promise<LeaveRequest> =>
    apiRequest<LeaveRequest>(`/leave/${id}/decision`, { method: 'POST', json: body }),
  cancel: (id: string): Promise<LeaveRequest> =>
    apiRequest<LeaveRequest>(`/leave/${id}/cancel`, { method: 'POST' }),
};

/** GET /leave-types (helper for the FE dropdown; assumes backend exposes it). */
export interface LeaveTypeOption {
  id: string;
  code: string;
  name: string;
  requiresAttachment: boolean;
}
export const leaveTypesApi = {
  list: (): Promise<LeaveTypeOption[]> =>
    apiRequest<LeaveTypeOption[]>('/leave/types', { method: 'GET' }),
};

// ----- Admin: Departments ---------------------------------------------------

export const departmentsAdminApi = {
  list: (): Promise<Department[]> =>
    apiRequest<Department[]>('/admin/departments', { method: 'GET' }),
  get: (id: string): Promise<Department> =>
    apiRequest<Department>(`/admin/departments/${id}`, { method: 'GET' }),
  create: (body: CreateDepartmentInput): Promise<Department> =>
    apiRequest<Department>('/admin/departments', { method: 'POST', json: body }),
  update: (id: string, body: UpdateDepartmentInput): Promise<Department> =>
    apiRequest<Department>(`/admin/departments/${id}`, { method: 'PATCH', json: body }),
  remove: (id: string): Promise<void> =>
    apiRequest<void>(`/admin/departments/${id}`, { method: 'DELETE' }),
};

// ----- Admin: Users ---------------------------------------------------------

function buildUserQueryString(q: ListUsersQuery | undefined): string {
  if (!q) return '';
  const params = new URLSearchParams();
  if (q.search) params.set('search', q.search);
  if (q.role) params.set('role', q.role);
  if (q.departmentId) params.set('departmentId', q.departmentId);
  if (q.status) params.set('status', q.status);
  if (q.includeInactive) params.set('includeInactive', 'true');
  const s = params.toString();
  return s ? `?${s}` : '';
}

export const usersAdminApi = {
  list: (query?: ListUsersQuery): Promise<AdminUser[]> =>
    apiRequest<AdminUser[]>(`/admin/users${buildUserQueryString(query)}`, { method: 'GET' }),
  get: (id: string): Promise<AdminUser> =>
    apiRequest<AdminUser>(`/admin/users/${id}`, { method: 'GET' }),
  create: (body: CreateUserInput): Promise<UserCredentialResponse> =>
    apiRequest<UserCredentialResponse>('/admin/users', { method: 'POST', json: body }),
  update: (id: string, body: UpdateUserInput): Promise<AdminUser> =>
    apiRequest<AdminUser>(`/admin/users/${id}`, { method: 'PATCH', json: body }),
  resetPassword: (id: string): Promise<UserCredentialResponse> =>
    apiRequest<UserCredentialResponse>(`/admin/users/${id}/reset-password`, { method: 'POST' }),
  deactivate: (id: string): Promise<void> =>
    apiRequest<void>(`/admin/users/${id}`, { method: 'DELETE' }),
};

// ----- Admin: Geofences -----------------------------------------------------

export const geofencesAdminApi = {
  list: (): Promise<Geofence[]> => apiRequest<Geofence[]>('/admin/geofences', { method: 'GET' }),
  get: (id: string): Promise<Geofence> =>
    apiRequest<Geofence>(`/admin/geofences/${id}`, { method: 'GET' }),
  create: (body: CreateGeofenceInput): Promise<Geofence> =>
    apiRequest<Geofence>('/admin/geofences', { method: 'POST', json: body }),
  update: (id: string, body: UpdateGeofenceInput): Promise<Geofence> =>
    apiRequest<Geofence>(`/admin/geofences/${id}`, { method: 'PATCH', json: body }),
  remove: (id: string): Promise<void> =>
    apiRequest<void>(`/admin/geofences/${id}`, { method: 'DELETE' }),
};

// ----- Admin: Shifts + Assignments ------------------------------------------

export const shiftsAdminApi = {
  list: (): Promise<Shift[]> => apiRequest<Shift[]>('/admin/shifts', { method: 'GET' }),
  create: (body: CreateShiftInput): Promise<Shift> =>
    apiRequest<Shift>('/admin/shifts', { method: 'POST', json: body }),
  update: (id: string, body: UpdateShiftInput): Promise<Shift> =>
    apiRequest<Shift>(`/admin/shifts/${id}`, { method: 'PATCH', json: body }),
  remove: (id: string): Promise<void> =>
    apiRequest<void>(`/admin/shifts/${id}`, { method: 'DELETE' }),
  /** Users in caller's tenant with no in-force UserShiftAssignment today. */
  listUsersWithoutActiveShift: (params?: { search?: string }): Promise<UserWithoutShift[]> => {
    const query = new URLSearchParams();
    if (params?.search) query.set('search', params.search);
    const suffix = query.toString() ? `?${query.toString()}` : '';
    return apiRequest<UserWithoutShift[]>(`/admin/shifts/users/without-active-shift${suffix}`, {
      method: 'GET',
    });
  },
};

export const shiftAssignmentsAdminApi = {
  listForUser: (userId: string): Promise<ShiftAssignment[]> =>
    apiRequest<ShiftAssignment[]>(`/admin/users/${userId}/shift-assignments`, { method: 'GET' }),
  create: (shiftId: string, body: CreateShiftAssignmentInput): Promise<ShiftAssignment> =>
    apiRequest<ShiftAssignment>(`/admin/shifts/${shiftId}/assignments`, {
      method: 'POST',
      json: body,
    }),
  end: (id: string, body: EndShiftAssignmentInput): Promise<ShiftAssignment> =>
    apiRequest<ShiftAssignment>(`/admin/shift-assignments/${id}/end`, {
      method: 'PATCH',
      json: body,
    }),
  remove: (id: string): Promise<void> =>
    apiRequest<void>(`/admin/shift-assignments/${id}`, { method: 'DELETE' }),
};

// ----- Admin: Leave Types ---------------------------------------------------

// ----- Reports (binary download) --------------------------------------------

interface BlobResult {
  blob: Blob;
  filename: string;
}

async function requestBlob(path: string, body: unknown, _retried = false): Promise<BlobResult> {
  const { accessToken, expiresAt } = authStore.get();
  let token = accessToken;
  if (!token || (expiresAt && expiresAt <= Date.now())) {
    token = await tryRefreshAccessToken();
  }

  const res = await fetch(`${baseUrl()}/api/v1${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
    credentials: 'include',
  });
  return handleBlobResponse(res, path, () => requestBlob(path, body, true), _retried);
}

/**
 * GET variant of `requestBlob` — used by streaming download endpoints
 * (NDJSON exports, etc.) where the request has no body and the
 * response is a large stream. Same auth + error handling contract.
 */
async function requestGetBlob(path: string, _retried = false): Promise<BlobResult> {
  const { accessToken, expiresAt } = authStore.get();
  let token = accessToken;
  if (!token || (expiresAt && expiresAt <= Date.now())) {
    token = await tryRefreshAccessToken();
  }

  const res = await fetch(`${baseUrl()}/api/v1${path}`, {
    method: 'GET',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    credentials: 'include',
  });
  return handleBlobResponse(res, path, () => requestGetBlob(path, true), _retried);
}

async function handleBlobResponse(
  res: Response,
  path: string,
  retry: () => Promise<BlobResult>,
  retried: boolean,
): Promise<BlobResult> {
  if (res.status === 401 && !retried) {
    const refreshed = await tryRefreshAccessToken();
    if (refreshed) return retry();
    authStore.clear();
  }

  if (!res.ok) {
    // Errors are JSON even on binary endpoints (renderer only writes on success)
    const text = await res.text();
    const parsed = text ? (JSON.parse(text) as ApiErrorPayload) : null;
    throw new ApiError(
      parsed ?? {
        statusCode: res.status,
        code: 'UNKNOWN',
        message: res.statusText,
        path,
        timestamp: new Date().toISOString(),
      },
    );
  }

  const disposition = res.headers.get('content-disposition') ?? '';
  const match = /filename="?([^";]+)"?/i.exec(disposition);
  const filename = match?.[1] ?? 'report.bin';
  const blob = await res.blob();
  return { blob, filename };
}

export const reportsApi = {
  attendance: (body: AttendanceReportRequest): Promise<BlobResult> =>
    requestBlob('/reports/attendance', body),
  leaveSummary: (body: LeaveSummaryReportRequest): Promise<BlobResult> =>
    requestBlob('/reports/leave-summary', body),
  overtimeSummary: (body: OvertimeReportRequest): Promise<BlobResult> =>
    requestBlob('/reports/overtime-summary', body),
};

export const timesheetExportApi = {
  create: (body: ExportTimesheetInput): Promise<BlobResult> =>
    requestBlob('/admin/timesheet/exports', body),
  list: (limit = 50): Promise<TimesheetExportListDto> =>
    apiRequest<TimesheetExportListDto>(
      `/admin/timesheet/exports?limit=${encodeURIComponent(limit)}`,
      { method: 'GET' },
    ),
  createShare: (exportId: string, body: CreateExportShareInput): Promise<ExportShareUrl> =>
    apiRequest<ExportShareUrl>(`/admin/timesheet/exports/${encodeURIComponent(exportId)}/shares`, {
      method: 'POST',
      json: body,
    }),
  listShares: (exportId: string): Promise<ExportShareListDto> =>
    apiRequest<ExportShareListDto>(
      `/admin/timesheet/exports/${encodeURIComponent(exportId)}/shares`,
      { method: 'GET' },
    ),
  revokeShare: (exportId: string, shareId: string): Promise<void> =>
    apiRequest<void>(
      `/admin/timesheet/exports/${encodeURIComponent(exportId)}/shares/${encodeURIComponent(shareId)}/revoke`,
      { method: 'POST', json: {} },
    ),
};

export const webhookApi = {
  list: (): Promise<WebhookEndpointListDto> =>
    apiRequest<WebhookEndpointListDto>('/admin/webhooks', { method: 'GET' }),
  create: (body: CreateWebhookInput): Promise<WebhookEndpointWithSecret> =>
    apiRequest<WebhookEndpointWithSecret>('/admin/webhooks', {
      method: 'POST',
      json: body,
    }),
  update: (id: string, body: UpdateWebhookInput): Promise<WebhookEndpointRow> =>
    apiRequest<WebhookEndpointRow>(`/admin/webhooks/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      json: body,
    }),
  remove: (id: string): Promise<void> =>
    apiRequest<void>(`/admin/webhooks/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),
  rotateSecret: (id: string): Promise<WebhookEndpointWithSecret> =>
    apiRequest<WebhookEndpointWithSecret>(
      `/admin/webhooks/${encodeURIComponent(id)}/rotate-secret`,
      { method: 'POST', json: {} },
    ),
  testFire: (id: string): Promise<{ enqueued: true }> =>
    apiRequest<{ enqueued: true }>(`/admin/webhooks/${encodeURIComponent(id)}/test-fire`, {
      method: 'POST',
      json: {},
    }),
  deliveries: (endpointId?: string): Promise<WebhookDeliveryListDto> => {
    const qs = endpointId ? `?endpointId=${encodeURIComponent(endpointId)}&limit=50` : '?limit=50';
    return apiRequest<WebhookDeliveryListDto>(`/admin/webhooks/deliveries${qs}`, { method: 'GET' });
  },
};

/** Trigger a browser download for the given blob (client-side only). */
export function saveBlob({ blob, filename }: BlobResult): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

// ----------------------------------------------------------------------------

export const leaveTypesAdminApi = {
  list: (): Promise<AdminLeaveType[]> =>
    apiRequest<AdminLeaveType[]>('/admin/leave-types', { method: 'GET' }),
  create: (body: CreateLeaveTypeInput): Promise<AdminLeaveType> =>
    apiRequest<AdminLeaveType>('/admin/leave-types', { method: 'POST', json: body }),
  update: (id: string, body: UpdateLeaveTypeInput): Promise<AdminLeaveType> =>
    apiRequest<AdminLeaveType>(`/admin/leave-types/${id}`, { method: 'PATCH', json: body }),
  remove: (id: string): Promise<void> =>
    apiRequest<void>(`/admin/leave-types/${id}`, { method: 'DELETE' }),
};

// ----- Overtime -------------------------------------------------------------

export interface OvertimeCompletionRunResult {
  scanned: number;
  completed: number;
  skipped: Record<string, number>;
  durationMs: number;
}

export const overtimeApi = {
  submit: (body: OvertimeRequestInput): Promise<OvertimeRequest> =>
    apiRequest<OvertimeRequest>('/overtime', { method: 'POST', json: body }),
  listMine: (year?: number): Promise<OvertimeRequest[]> =>
    apiRequest<OvertimeRequest[]>(`/overtime/mine${year ? `?year=${year}` : ''}`, {
      method: 'GET',
    }),
  listPendingApprovals: (): Promise<OvertimeRequest[]> =>
    apiRequest<OvertimeRequest[]>('/overtime/approvals/pending', { method: 'GET' }),
  decide: (id: string, body: OvertimeDecisionInput): Promise<OvertimeRequest> =>
    apiRequest<OvertimeRequest>(`/overtime/${id}/decision`, {
      method: 'POST',
      json: body,
    }),
  cancel: (id: string): Promise<OvertimeRequest> =>
    apiRequest<OvertimeRequest>(`/overtime/${id}/cancel`, { method: 'POST' }),
  runCompletion: (): Promise<OvertimeCompletionRunResult> =>
    apiRequest<OvertimeCompletionRunResult>('/admin/overtime/run-completion', {
      method: 'POST',
    }),
};

// ----- Attachments (presigned S3 upload) ------------------------------------

export const attachmentsApi = {
  presign: (body: PresignPutRequest): Promise<PresignPutResponse> =>
    apiRequest<PresignPutResponse>('/attachments/presign', { method: 'POST', json: body }),
};

export interface UploadProgress {
  loaded: number;
  total: number;
  percent: number;
}

/**
 * Upload a file to a presigned S3 URL. Uses XHR (not fetch) so we can surface
 * per-chunk progress to the UI, which is important for the 5 MiB attachment
 * cap on slow mobile connections. On success returns the same `fileKey` the
 * caller passed in — the FE then submits this key with the leave request.
 */
export function uploadFileWithPresign(
  file: File,
  presigned: PresignPutResponse,
  onProgress?: (p: UploadProgress) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', presigned.uploadUrl, true);
    // Headers MUST match what the server signed — send them verbatim.
    for (const [name, value] of Object.entries(presigned.requiredHeaders)) {
      xhr.setRequestHeader(name, value);
    }
    xhr.upload.addEventListener('progress', (evt) => {
      if (!onProgress || !evt.lengthComputable) return;
      onProgress({
        loaded: evt.loaded,
        total: evt.total,
        percent: Math.round((evt.loaded / evt.total) * 100),
      });
    });
    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        reject(
          new Error(`S3 upload failed with HTTP ${xhr.status}: ${xhr.responseText.slice(0, 200)}`),
        );
      }
    });
    xhr.addEventListener('error', () => reject(new Error('S3 upload network error')));
    xhr.addEventListener('abort', () => reject(new Error('S3 upload aborted')));
    xhr.send(file);
  });
}

// ----- Admin: Holidays ------------------------------------------------------

export const holidaysAdminApi = {
  list: (year?: number): Promise<Holiday[]> =>
    apiRequest<Holiday[]>(`/admin/holidays${year ? `?year=${year}` : ''}`, { method: 'GET' }),
  create: (body: CreateHolidayInput): Promise<Holiday> =>
    apiRequest<Holiday>('/admin/holidays', { method: 'POST', json: body }),
  update: (id: string, body: UpdateHolidayInput): Promise<Holiday> =>
    apiRequest<Holiday>(`/admin/holidays/${id}`, { method: 'PATCH', json: body }),
  remove: (id: string): Promise<void> =>
    apiRequest<void>(`/admin/holidays/${id}`, { method: 'DELETE' }),
  bulk: (body: BulkImportHolidaysInput): Promise<BulkImportHolidaysResponse> =>
    apiRequest<BulkImportHolidaysResponse>('/admin/holidays/bulk', {
      method: 'POST',
      json: body,
    }),
};

// ----- Admin: Approvals backlog --------------------------------------------

/**
 * Cross-module PENDING approval visibility. HR + SUPER_ADMIN only —
 * supervisors keep their scoped per-module views.
 */
export const backlogAdminApi = {
  get: (q: { thresholdDays?: number; topN?: number } = {}): Promise<BacklogSummary> => {
    const params = new URLSearchParams();
    if (q.thresholdDays !== undefined) params.set('thresholdDays', String(q.thresholdDays));
    if (q.topN !== undefined) params.set('topN', String(q.topN));
    const suffix = params.toString() ? `?${params.toString()}` : '';
    return apiRequest<BacklogSummary>(`/admin/approvals/backlog${suffix}`, {
      method: 'GET',
    });
  },
};

// ----- Admin: Audit Log -----------------------------------------------------

/**
 * Read-only audit log viewer for HR / compliance. Every mutation of
 * significance across the system (leave decisions, overtime, absence
 * overrides, config updates, scanner cursor resets) writes here.
 * Response is keyset-paginated — pass the previous response's
 * `nextCursor` to fetch the next page.
 */
export const auditAdminApi = {
  list: (filters: AuditLogFilters = {}): Promise<AuditLogPage> => {
    const params = new URLSearchParams();
    if (filters.entityType) params.set('entityType', filters.entityType);
    if (filters.entityId) params.set('entityId', filters.entityId);
    if (filters.actorId) params.set('actorId', filters.actorId);
    if (filters.action) params.set('action', filters.action);
    if (filters.from) params.set('from', filters.from);
    if (filters.to) params.set('to', filters.to);
    if (filters.cursor) params.set('cursor', filters.cursor);
    if (filters.limit !== undefined) params.set('limit', String(filters.limit));
    const suffix = params.toString() ? `?${params.toString()}` : '';
    return apiRequest<AuditLogPage>(`/admin/audit-log${suffix}`, {
      method: 'GET',
    });
  },
  /**
   * Stream the tenant's audit log as NDJSON, downloadable as a file.
   * Same filter surface as `list()` minus `cursor`/`limit` — the export
   * always returns the full matching set (up to the server-side cap
   * documented in ADR-0013).
   */
  exportNdjson: (filters: Omit<AuditLogFilters, 'cursor' | 'limit'> = {}): Promise<BlobResult> => {
    const params = new URLSearchParams();
    if (filters.entityType) params.set('entityType', filters.entityType);
    if (filters.entityId) params.set('entityId', filters.entityId);
    if (filters.actorId) params.set('actorId', filters.actorId);
    if (filters.action) params.set('action', filters.action);
    if (filters.from) params.set('from', filters.from);
    if (filters.to) params.set('to', filters.to);
    const suffix = params.toString() ? `?${params.toString()}` : '';
    return requestGetBlob(`/admin/audit-log/export${suffix}`);
  },
};

// ----- Admin: Company Config ------------------------------------------------

export const companyAdminApi = {
  get: (): Promise<CompanyConfig> => apiRequest<CompanyConfig>('/admin/company', { method: 'GET' }),
  update: (body: CompanyConfigUpdateInput): Promise<CompanyConfig> =>
    apiRequest<CompanyConfig>('/admin/company', { method: 'PATCH', json: body }),
};

// ----- SUPER_ADMIN: Cross-tenant Companies ---------------------------------

/**
 * SUPER_ADMIN-only surface. Distinct from `companyAdminApi` (singular),
 * which is tenant-scoped and shared with HR_MANAGER. See ADR-0016.
 */
export const companiesAdminApi = {
  list: (query: ListCompaniesQuery = {}): Promise<ListCompaniesResponse> => {
    const params = new URLSearchParams();
    if (query.page !== undefined) params.set('page', String(query.page));
    if (query.pageSize !== undefined) params.set('pageSize', String(query.pageSize));
    if (query.includeDeleted) params.set('includeDeleted', 'true');
    if (query.search) params.set('search', query.search);
    const suffix = params.toString() ? `?${params.toString()}` : '';
    return apiRequest<ListCompaniesResponse>(`/admin/companies${suffix}`, {
      method: 'GET',
    });
  },
  get: (id: string): Promise<CompanyAdmin> =>
    apiRequest<CompanyAdmin>(`/admin/companies/${encodeURIComponent(id)}`, {
      method: 'GET',
    }),
  /**
   * Bootstrap a new tenant. Response includes a one-time temp password —
   * render it via `<CredentialReveal>` and do NOT cache in localStorage
   * or the React Query cache (`onSuccess` handler should surface it in
   * transient component state, then clear).
   */
  create: (body: CreateCompanyInput): Promise<CompanyBootstrap> =>
    apiRequest<CompanyBootstrap>('/admin/companies', {
      method: 'POST',
      json: body,
    }),
  update: (id: string, body: UpdateCompanyInput): Promise<CompanyAdmin> =>
    apiRequest<CompanyAdmin>(`/admin/companies/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      json: body,
    }),
  softDelete: (id: string): Promise<void> =>
    apiRequest<void>(`/admin/companies/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),
  restore: (id: string): Promise<CompanyAdmin> =>
    apiRequest<CompanyAdmin>(`/admin/companies/${encodeURIComponent(id)}/restore`, {
      method: 'POST',
    }),
};

// ----- Admin: ROPA (Fase 31d) ---------------------------------------------

export const ropaAdminApi = {
  list: (): Promise<RopaActivityListItem[]> =>
    apiRequest<RopaActivityListItem[]>('/admin/ropa/activities', {
      method: 'GET',
    }),
  detail: (id: string): Promise<RopaActivityDetail> =>
    apiRequest<RopaActivityDetail>(`/admin/ropa/activities/${encodeURIComponent(id)}`, {
      method: 'GET',
    }),
  create: (body: CreateRopaActivityInput): Promise<RopaVersionResponse> =>
    apiRequest<RopaVersionResponse>('/admin/ropa/activities', {
      method: 'POST',
      json: body,
    }),
  seedDefaults: (): Promise<SeedRopaResponse> =>
    apiRequest<SeedRopaResponse>('/admin/ropa/seed-defaults', {
      method: 'POST',
      json: {},
    }),
  patchVersion: (
    activityId: string,
    versionId: string,
    body: UpdateRopaVersionInput,
  ): Promise<RopaVersionResponse> =>
    apiRequest<RopaVersionResponse>(
      `/admin/ropa/activities/${encodeURIComponent(activityId)}/versions/${encodeURIComponent(versionId)}`,
      { method: 'PATCH', json: body },
    ),
  submitReview: (activityId: string, versionId: string): Promise<RopaVersionResponse> =>
    apiRequest<RopaVersionResponse>(
      `/admin/ropa/activities/${encodeURIComponent(activityId)}/versions/${encodeURIComponent(versionId)}/submit-review`,
      { method: 'POST', json: {} },
    ),
  returnToDraft: (activityId: string, versionId: string): Promise<RopaVersionResponse> =>
    apiRequest<RopaVersionResponse>(
      `/admin/ropa/activities/${encodeURIComponent(activityId)}/versions/${encodeURIComponent(versionId)}/return-to-draft`,
      { method: 'POST', json: {} },
    ),
  publish: (activityId: string, versionId: string): Promise<RopaVersionResponse> =>
    apiRequest<RopaVersionResponse>(
      `/admin/ropa/activities/${encodeURIComponent(activityId)}/versions/${encodeURIComponent(versionId)}/publish`,
      { method: 'POST', json: {} },
    ),
  newVersion: (activityId: string): Promise<RopaVersionResponse> =>
    apiRequest<RopaVersionResponse>(
      `/admin/ropa/activities/${encodeURIComponent(activityId)}/new-version`,
      { method: 'POST', json: {} },
    ),
  exportPdf: (): Promise<BlobResult> => requestGetBlob('/admin/ropa/export.pdf'),
  exportXlsx: (): Promise<BlobResult> => requestGetBlob('/admin/ropa/export.xlsx'),
};

// ----- Admin: DPIA (Fase 31e) ---------------------------------------------

/**
 * DPIA registry. HR / Super Admin only. Every mutation on the API side
 * writes an `AuditLog` row inside the same transaction — the FE does
 * not need to emit anything additional.
 */
export const dpiaAdminApi = {
  list: (): Promise<DpiaAssessmentListItem[]> =>
    apiRequest<DpiaAssessmentListItem[]>('/admin/dpia/assessments', {
      method: 'GET',
    }),
  detail: (id: string): Promise<DpiaAssessmentResponse> =>
    apiRequest<DpiaAssessmentResponse>(`/admin/dpia/assessments/${encodeURIComponent(id)}`, {
      method: 'GET',
    }),
  create: (body: CreateDpiaAssessmentInput): Promise<DpiaAssessmentResponse> =>
    apiRequest<DpiaAssessmentResponse>('/admin/dpia/assessments', {
      method: 'POST',
      json: body,
    }),
  patch: (id: string, body: UpdateDpiaAssessmentInput): Promise<DpiaAssessmentResponse> =>
    apiRequest<DpiaAssessmentResponse>(`/admin/dpia/assessments/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      json: body,
    }),
  submitReview: (id: string): Promise<DpiaAssessmentResponse> =>
    apiRequest<DpiaAssessmentResponse>(
      `/admin/dpia/assessments/${encodeURIComponent(id)}/submit-review`,
      { method: 'POST', json: {} },
    ),
  returnToDraft: (id: string): Promise<DpiaAssessmentResponse> =>
    apiRequest<DpiaAssessmentResponse>(
      `/admin/dpia/assessments/${encodeURIComponent(id)}/return-to-draft`,
      { method: 'POST', json: {} },
    ),
  approve: (id: string): Promise<DpiaAssessmentResponse> =>
    apiRequest<DpiaAssessmentResponse>(
      `/admin/dpia/assessments/${encodeURIComponent(id)}/approve`,
      { method: 'POST', json: {} },
    ),
  addRisk: (id: string, body: CreateDpiaRiskItemInput): Promise<DpiaAssessmentResponse> =>
    apiRequest<DpiaAssessmentResponse>(
      `/admin/dpia/assessments/${encodeURIComponent(id)}/risk-items`,
      { method: 'POST', json: body },
    ),
  patchRisk: (
    id: string,
    riskItemId: string,
    body: UpdateDpiaRiskItemInput,
  ): Promise<DpiaAssessmentResponse> =>
    apiRequest<DpiaAssessmentResponse>(
      `/admin/dpia/assessments/${encodeURIComponent(id)}/risk-items/${encodeURIComponent(riskItemId)}`,
      { method: 'PATCH', json: body },
    ),
  removeRisk: (id: string, riskItemId: string): Promise<DpiaAssessmentResponse> =>
    apiRequest<DpiaAssessmentResponse>(
      `/admin/dpia/assessments/${encodeURIComponent(id)}/risk-items/${encodeURIComponent(riskItemId)}`,
      { method: 'DELETE' },
    ),
  exportPdf: (id: string): Promise<BlobResult> =>
    requestGetBlob(`/admin/dpia/assessments/${encodeURIComponent(id)}/export.pdf`),
};

// ----- Admin: Scheduled Reports (Fase 33c) ---------------------------------

/**
 * CRUD + delivery log for scheduled email reports. HR / super-admin
 * only. Mutations advance `nextRunAt` server-side — the FE does not
 * need to compute it.
 */
export const reportScheduleAdminApi = {
  registry: (): Promise<ReportRegistryEntry[]> =>
    apiRequest<ReportRegistryEntry[]>('/admin/reports/registry', {
      method: 'GET',
    }),
  list: (): Promise<ReportScheduleResponse[]> =>
    apiRequest<ReportScheduleResponse[]>('/admin/reports/schedules', {
      method: 'GET',
    }),
  create: (body: CreateReportScheduleInput): Promise<ReportScheduleResponse> =>
    apiRequest<ReportScheduleResponse>('/admin/reports/schedules', {
      method: 'POST',
      json: body,
    }),
  update: (id: string, body: UpdateReportScheduleInput): Promise<ReportScheduleResponse> =>
    apiRequest<ReportScheduleResponse>(`/admin/reports/schedules/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      json: body,
    }),
  remove: (id: string): Promise<void> =>
    apiRequest<void>(`/admin/reports/schedules/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  deliveries: (id: string): Promise<ReportDeliveryResponse[]> =>
    apiRequest<ReportDeliveryResponse[]>(
      `/admin/reports/schedules/${encodeURIComponent(id)}/deliveries`,
      { method: 'GET' },
    ),
};

// ----- Admin: Custom Report Builder (Fase 33b) ----------------------------

/**
 * HR / super-admin ad-hoc + saved custom reports. Every payload is
 * validated against the closed dimension × metric catalogue on the
 * server before execution — the FE can trust the shape returned.
 */
export const customReportAdminApi = {
  catalogue: (): Promise<CustomReportCatalogue> =>
    apiRequest<CustomReportCatalogue>('/admin/reports/custom/catalogue', {
      method: 'GET',
    }),
  preview: (definition: CustomReportDefinition): Promise<CustomReportResult> =>
    apiRequest<CustomReportResult>('/admin/reports/custom/preview', {
      method: 'POST',
      json: { definition },
    }),
  listSaved: (): Promise<SavedReportResponse[]> =>
    apiRequest<SavedReportResponse[]>('/admin/reports/custom/saved', {
      method: 'GET',
    }),
  detailSaved: (id: string): Promise<SavedReportResponse> =>
    apiRequest<SavedReportResponse>(`/admin/reports/custom/saved/${encodeURIComponent(id)}`, {
      method: 'GET',
    }),
  createSaved: (body: CreateSavedReportInput): Promise<SavedReportResponse> =>
    apiRequest<SavedReportResponse>('/admin/reports/custom/saved', {
      method: 'POST',
      json: body,
    }),
  updateSaved: (id: string, body: UpdateSavedReportInput): Promise<SavedReportResponse> =>
    apiRequest<SavedReportResponse>(`/admin/reports/custom/saved/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      json: body,
    }),
  removeSaved: (id: string): Promise<void> =>
    apiRequest<void>(`/admin/reports/custom/saved/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  exportCsv: (id: string): Promise<BlobResult> =>
    requestGetBlob(`/admin/reports/custom/saved/${encodeURIComponent(id)}/export.csv`),
  exportXlsx: (id: string): Promise<BlobResult> =>
    requestGetBlob(`/admin/reports/custom/saved/${encodeURIComponent(id)}/export.xlsx`),
};

// ----- Admin: Breach Notification Ledger (Fase 31g) ----------------------

/**
 * HR / super-admin breach ledger. Deadline math is server-anchored on
 * `detectedAt` — the FE only renders `deadline.hoursRemaining` +
 * `deadline.bucket` from the response.
 */
export const breachLedgerAdminApi = {
  list: (): Promise<BreachIncidentListItem[]> =>
    apiRequest<BreachIncidentListItem[]>('/admin/security/breaches', {
      method: 'GET',
    }),
  detail: (id: string): Promise<BreachIncidentResponse> =>
    apiRequest<BreachIncidentResponse>(`/admin/security/breaches/${encodeURIComponent(id)}`, {
      method: 'GET',
    }),
  create: (body: CreateBreachIncidentInput): Promise<BreachIncidentResponse> =>
    apiRequest<BreachIncidentResponse>('/admin/security/breaches', {
      method: 'POST',
      json: body,
    }),
  update: (id: string, body: UpdateBreachIncidentInput): Promise<BreachIncidentResponse> =>
    apiRequest<BreachIncidentResponse>(`/admin/security/breaches/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      json: body,
    }),
  markContained: (id: string, note: string): Promise<BreachIncidentResponse> =>
    apiRequest<BreachIncidentResponse>(
      `/admin/security/breaches/${encodeURIComponent(id)}/mark-contained`,
      { method: 'POST', json: { note } satisfies AppendBreachNoteInput },
    ),
  notifyAuthority: (id: string, body: NotifyAuthorityInput): Promise<BreachIncidentResponse> =>
    apiRequest<BreachIncidentResponse>(
      `/admin/security/breaches/${encodeURIComponent(id)}/notify-authority`,
      { method: 'POST', json: body },
    ),
  notifySubjects: (id: string, body: NotifySubjectsInput): Promise<BreachIncidentResponse> =>
    apiRequest<BreachIncidentResponse>(
      `/admin/security/breaches/${encodeURIComponent(id)}/notify-subjects`,
      { method: 'POST', json: body },
    ),
  close: (id: string, body: CloseBreachInput): Promise<BreachIncidentResponse> =>
    apiRequest<BreachIncidentResponse>(`/admin/security/breaches/${encodeURIComponent(id)}/close`, {
      method: 'POST',
      json: body,
    }),
  appendNote: (id: string, body: AppendBreachNoteInput): Promise<BreachIncidentResponse> =>
    apiRequest<BreachIncidentResponse>(`/admin/security/breaches/${encodeURIComponent(id)}/notes`, {
      method: 'POST',
      json: body,
    }),
  exportPdf: (id: string): Promise<BlobResult> =>
    requestGetBlob(`/admin/security/breaches/${encodeURIComponent(id)}/export.pdf`),
};

// ----- Notifications -------------------------------------------------------

/**
 * The bell polls `unreadCount` frequently and `list` only when the dropdown
 * opens. Keep response shapes narrow — the frontend hydrates icons /
 * timestamps from the `type` + `createdAt` fields, no server-side HTML.
 */
export const notificationsApi = {
  list: (opts: { unreadOnly?: boolean; limit?: number } = {}): Promise<Notification[]> => {
    const params = new URLSearchParams();
    if (opts.unreadOnly) params.set('unreadOnly', 'true');
    if (opts.limit) params.set('limit', String(opts.limit));
    const suffix = params.toString() ? `?${params.toString()}` : '';
    return apiRequest<Notification[]>(`/notifications${suffix}`, { method: 'GET' });
  },
  unreadCount: (): Promise<UnreadCountResponse> =>
    apiRequest<UnreadCountResponse>('/notifications/unread-count', { method: 'GET' }),
  markRead: (id: string): Promise<void> =>
    apiRequest<void>(`/notifications/${encodeURIComponent(id)}/read`, { method: 'POST' }),
  markAllRead: (): Promise<{ marked: number }> =>
    apiRequest<{ marked: number }>('/notifications/read-all', { method: 'POST' }),
  /**
   * Paginated archive for the `/notifications` page (Fase 25). Uses a
   * keyset cursor — pass the previous response's `nextCursor` verbatim
   * to fetch the next page. Distinct from `list()` because the archive
   * envelope wraps rows + cursor.
   */
  listArchive: (
    opts: { unreadOnly?: boolean; limit?: number; cursor?: string } = {},
  ): Promise<NotificationPage> => {
    const params = new URLSearchParams();
    if (opts.unreadOnly) params.set('unreadOnly', 'true');
    if (opts.limit) params.set('limit', String(opts.limit));
    if (opts.cursor) params.set('cursor', opts.cursor);
    const suffix = params.toString() ? `?${params.toString()}` : '';
    return apiRequest<NotificationPage>(`/notifications/archive${suffix}`, {
      method: 'GET',
    });
  },
  /**
   * Fetch the caller's preference matrix. Returns one row per known
   * NotificationType, hydrated with stored overrides or defaults-on.
   */
  listPreferences: (): Promise<NotificationPreferenceRow[]> =>
    apiRequest<NotificationPreferenceRow[]>('/notifications/preferences', {
      method: 'GET',
    }),
  /**
   * Bulk-upsert preference overrides. Response is the fresh full list —
   * the FE can trust it as the new state without a follow-up refetch.
   */
  updatePreferences: (
    body: UpdateNotificationPreferencesInput,
  ): Promise<NotificationPreferenceRow[]> =>
    apiRequest<NotificationPreferenceRow[]>('/notifications/preferences', {
      method: 'PUT',
      json: body,
    }),
};

// ----- Admin: Analytics (Fase 33a) ----------------------------------------

/**
 * Executive-KPI dashboard read layer. Both endpoints are HR / super-admin
 * only, throttled at 60/min server-side. The FE consumes the raw
 * response and hydrates icons + colours via the metric descriptor list.
 */
export const analyticsAdminApi = {
  dashboard: (opts: { windowDays?: AnalyticsWindowDays } = {}): Promise<DashboardResponse> => {
    const params = new URLSearchParams();
    if (opts.windowDays) params.set('windowDays', String(opts.windowDays));
    const suffix = params.toString() ? `?${params.toString()}` : '';
    return apiRequest<DashboardResponse>(`/admin/analytics/dashboard${suffix}`, {
      method: 'GET',
    });
  },
  timeseries: (opts: {
    metricKey: AnalyticsMetricKey;
    windowDays?: AnalyticsWindowDays;
  }): Promise<TimeseriesResponse> => {
    const params = new URLSearchParams();
    params.set('metricKey', opts.metricKey);
    if (opts.windowDays) params.set('windowDays', String(opts.windowDays));
    return apiRequest<TimeseriesResponse>(`/admin/analytics/timeseries?${params.toString()}`, {
      method: 'GET',
    });
  },
};
