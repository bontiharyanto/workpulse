/**
 * Declarative navigation model — the single source of truth for the
 * sidebar, the mobile drawer, the top-bar breadcrumb, and (Fase 3+)
 * the command palette. Every renderer walks this shape; no hard-coded
 * links live in the rendering components.
 *
 * A `NavItem` is intentionally UI-agnostic:
 *   - `roles` gates by `UserRole` (server truth is still the guard;
 *     this is UX polish only)
 *   - `module` maps to the `--module-*` accent token in globals.css
 *     so the sidebar can paint an active-item indicator without the
 *     component having to know the color
 *   - `icon` is a `lucide-react` component reference, not a JSX
 *     element, so config files stay declarative + easy to lint
 *
 * Admin surface: intentionally exploded into six topical sections
 * (Data Master, Analytics & Laporan, Timesheet Admin, Compliance,
 * System, and the singleton Persetujuan Backlog) rather than one
 * gigantic "Admin" section. Reason: a flat 20+ item list overloads
 * short-term memory. Topical grouping matches how HR practitioners
 * actually chunk their workflows, and dropping the old
 * `admin/_components/admin-subnav.tsx` horizontal tab bar in favour
 * of this sidebar model gives us a single source of navigation truth.
 */
import type { UserRole } from '@workpulse/shared-types';
import {
  Activity,
  BarChart3,
  Bell,
  Building2,
  Calendar,
  CalendarClock,
  CheckCheck,
  CheckCircle2,
  ClipboardList,
  Clock,
  Cog,
  Download,
  FileBarChart,
  FileSpreadsheet,
  FileText,
  Fingerprint,
  Gauge,
  HandCoins,
  Inbox,
  KeyRound,
  Layers,
  LifeBuoy,
  LineChart,
  MapPin,
  ScrollText,
  Settings,
  Shield,
  ShieldAlert,
  Sun,
  Trash2,
  UserCircle,
  Users,
  Webhook,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export type NavModule = 'attendance' | 'leave' | 'overtime' | 'timesheet' | 'admin';

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  module?: NavModule;
  roles?: UserRole[];
  /** Optional short description used by the command palette (Fase 3). */
  description?: string;
}

export interface NavSection {
  id: string;
  label: string;
  items: NavItem[];
  /** Section is hidden entirely when the current user matches none of these roles. */
  roles?: UserRole[];
}

const APPROVER_ROLES: UserRole[] = ['SUPERVISOR', 'HR_MANAGER', 'SUPER_ADMIN'];
const ADMIN_ROLES: UserRole[] = ['HR_MANAGER', 'SUPER_ADMIN'];
const SUPER_ADMIN_ROLES: UserRole[] = ['SUPER_ADMIN'];

export const workspaceSection: NavSection = {
  id: 'workspace',
  label: 'Workspace',
  items: [
    {
      href: '/attendance',
      label: 'Kehadiran',
      icon: Clock,
      module: 'attendance',
      description: 'Clock-in / clock-out, riwayat kehadiran, koreksi.',
    },
    {
      href: '/leave',
      label: 'Cuti',
      icon: Sun,
      module: 'leave',
      description: 'Pengajuan cuti, saldo, kalender.',
    },
    {
      href: '/overtime',
      label: 'Lembur',
      icon: Activity,
      module: 'overtime',
      description: 'Pengajuan lembur, riwayat, perhitungan rate.',
    },
    {
      href: '/me/timesheet',
      label: 'Timesheet',
      icon: FileSpreadsheet,
      module: 'timesheet',
      description: 'Periode berjalan, submit, riwayat.',
    },
  ],
};

export const approvalsSection: NavSection = {
  id: 'approvals',
  label: 'Persetujuan',
  roles: APPROVER_ROLES,
  items: [
    {
      href: '/leave/approvals',
      label: 'Approval Cuti',
      icon: CheckCircle2,
      module: 'leave',
      roles: APPROVER_ROLES,
    },
    {
      href: '/overtime/approvals',
      label: 'Approval Lembur',
      icon: CheckCheck,
      module: 'overtime',
      roles: APPROVER_ROLES,
    },
    {
      href: '/admin/timesheet',
      label: 'Approval Timesheet',
      icon: ClipboardList,
      module: 'timesheet',
      roles: APPROVER_ROLES,
    },
    {
      href: '/admin/approvals-backlog',
      label: 'Backlog Approval',
      icon: Inbox,
      module: 'admin',
      roles: ADMIN_ROLES,
    },
    {
      href: '/team/location-requests',
      label: 'Permintaan Lokasi',
      icon: MapPin,
      module: 'attendance',
      roles: APPROVER_ROLES,
      description:
        'Kirim permintaan lokasi ke karyawan lapangan yang telah opt-in (ADR-0041).',
    },
  ],
};

export const dataMasterSection: NavSection = {
  id: 'admin-master',
  label: 'Data Master',
  roles: ADMIN_ROLES,
  items: [
    { href: '/admin/users', label: 'Karyawan', icon: Users, module: 'admin', roles: ADMIN_ROLES },
    {
      href: '/admin/departments',
      label: 'Departemen',
      icon: Layers,
      module: 'admin',
      roles: ADMIN_ROLES,
    },
    {
      href: '/admin/geofences',
      label: 'Geofence',
      icon: MapPin,
      module: 'admin',
      roles: ADMIN_ROLES,
    },
    {
      href: '/admin/shifts',
      label: 'Shift',
      icon: Calendar,
      module: 'admin',
      roles: ADMIN_ROLES,
    },
    {
      href: '/admin/leave-types',
      label: 'Tipe Cuti',
      icon: HandCoins,
      module: 'admin',
      roles: ADMIN_ROLES,
    },
    {
      href: '/admin/holidays',
      label: 'Hari Libur',
      icon: CalendarClock,
      module: 'admin',
      roles: ADMIN_ROLES,
    },
    {
      href: '/admin/company',
      label: 'Konfigurasi Perusahaan',
      icon: Building2,
      module: 'admin',
      roles: ADMIN_ROLES,
    },
  ],
};

export const analyticsSection: NavSection = {
  id: 'admin-analytics',
  label: 'Analytics & Laporan',
  roles: ADMIN_ROLES,
  items: [
    {
      href: '/admin/analytics',
      label: 'Executive Dashboard',
      icon: LineChart,
      module: 'admin',
      roles: ADMIN_ROLES,
    },
    {
      href: '/admin/reports',
      label: 'Laporan',
      icon: BarChart3,
      module: 'admin',
      roles: ADMIN_ROLES,
    },
    {
      href: '/admin/reports/schedules',
      label: 'Jadwal Laporan',
      icon: CalendarClock,
      module: 'admin',
      roles: ADMIN_ROLES,
    },
    {
      href: '/admin/reports/custom',
      label: 'Custom Report',
      icon: FileBarChart,
      module: 'admin',
      roles: ADMIN_ROLES,
    },
    {
      href: '/admin/usage',
      label: 'Penggunaan API',
      icon: Gauge,
      module: 'admin',
      roles: ADMIN_ROLES,
    },
  ],
};

export const timesheetAdminSection: NavSection = {
  id: 'admin-timesheet',
  label: 'Timesheet Admin',
  roles: ADMIN_ROLES,
  items: [
    {
      href: '/admin/timesheet',
      label: 'Rekap Timesheet',
      icon: ClipboardList,
      module: 'timesheet',
      roles: ADMIN_ROLES,
    },
    {
      href: '/admin/timesheet/config',
      label: 'Konfigurasi',
      icon: Cog,
      module: 'timesheet',
      roles: ADMIN_ROLES,
    },
    {
      href: '/admin/timesheet/exports',
      label: 'Riwayat Ekspor',
      icon: Download,
      module: 'timesheet',
      roles: ADMIN_ROLES,
    },
  ],
};

export const complianceSection: NavSection = {
  id: 'admin-compliance',
  label: 'Compliance',
  roles: ADMIN_ROLES,
  items: [
    { href: '/admin/ropa', label: 'ROPA', icon: FileText, module: 'admin', roles: ADMIN_ROLES },
    { href: '/admin/dpia', label: 'DPIA', icon: Shield, module: 'admin', roles: ADMIN_ROLES },
    {
      href: '/admin/privacy/policies',
      label: 'Kebijakan Privasi',
      icon: ScrollText,
      module: 'admin',
      roles: ADMIN_ROLES,
    },
    {
      href: '/admin/privacy/vendors',
      label: 'Vendor Register',
      icon: Building2,
      module: 'admin',
      roles: ADMIN_ROLES,
    },
    {
      href: '/admin/privacy/erasure-requests',
      label: 'Permintaan Penghapusan',
      icon: Trash2,
      module: 'admin',
      roles: ADMIN_ROLES,
    },
    {
      href: '/admin/privacy/retention',
      label: 'Retensi Data',
      icon: CalendarClock,
      module: 'admin',
      roles: ADMIN_ROLES,
    },
    {
      href: '/admin/security/breaches',
      label: 'Breach Ledger',
      icon: ShieldAlert,
      module: 'admin',
      roles: ADMIN_ROLES,
    },
    {
      href: '/admin/security',
      label: 'Kebijakan Keamanan',
      icon: Shield,
      module: 'admin',
      roles: SUPER_ADMIN_ROLES,
    },
  ],
};

export const systemSection: NavSection = {
  id: 'admin-system',
  label: 'System',
  roles: ADMIN_ROLES,
  items: [
    {
      href: '/admin/webhooks',
      label: 'Webhooks',
      icon: Webhook,
      module: 'admin',
      roles: ADMIN_ROLES,
    },
    {
      href: '/admin/audit-log',
      label: 'Audit Log',
      icon: Fingerprint,
      module: 'admin',
      roles: ADMIN_ROLES,
    },
    {
      href: '/admin/companies',
      label: 'Tenant',
      icon: Building2,
      module: 'admin',
      roles: SUPER_ADMIN_ROLES,
    },
  ],
};

export const userMenuItems: NavItem[] = [
  { href: '/settings/profile', label: 'Profil', icon: UserCircle },
  { href: '/settings/security', label: 'Keamanan & MFA', icon: KeyRound },
  { href: '/settings/notifications', label: 'Preferensi Notifikasi', icon: Bell },
  { href: '/notifications', label: 'Notifikasi', icon: Bell },
  { href: '/change-password', label: 'Ubah Password', icon: Settings },
];

export const helpItems: NavItem[] = [{ href: '/help', label: 'Bantuan', icon: LifeBuoy }];

export const navSections: NavSection[] = [
  workspaceSection,
  approvalsSection,
  dataMasterSection,
  analyticsSection,
  timesheetAdminSection,
  complianceSection,
  systemSection,
];

/**
 * Pretty label for a raw URL segment. Used by the breadcrumb.
 * The mapping is intentionally exhaustive for the top-level routes
 * we ship; anything unknown falls back to Title Case.
 */
export const segmentLabels: Record<string, string> = {
  attendance: 'Kehadiran',
  leave: 'Cuti',
  overtime: 'Lembur',
  approvals: 'Approvals',
  timesheet: 'Timesheet',
  me: 'Saya',
  admin: 'Admin',
  users: 'Karyawan',
  departments: 'Departemen',
  geofences: 'Geofence',
  shifts: 'Shift',
  'leave-types': 'Tipe Cuti',
  holidays: 'Hari Libur',
  company: 'Konfigurasi Perusahaan',
  companies: 'Tenant',
  reports: 'Laporan',
  schedules: 'Jadwal',
  custom: 'Custom',
  usage: 'Penggunaan API',
  webhooks: 'Webhooks',
  privacy: 'Privasi',
  policies: 'Kebijakan',
  vendors: 'Vendor',
  'erasure-requests': 'Permintaan Penghapusan',
  retention: 'Retensi',
  'audit-reports': 'Laporan Audit',
  'audit-log': 'Audit Log',
  analytics: 'Analytics',
  ropa: 'ROPA',
  dpia: 'DPIA',
  security: 'Keamanan',
  breaches: 'Breach Ledger',
  team: 'Tim',
  'location-requests': 'Permintaan Lokasi',
  'location-sharing': 'Berbagi Lokasi',
  inbox: 'Inbox',
  'approvals-backlog': 'Backlog',
  exports: 'Ekspor',
  config: 'Konfigurasi',
  settings: 'Pengaturan',
  profile: 'Profil',
  notifications: 'Notifikasi',
  'change-password': 'Ubah Password',
  'reset-password': 'Reset Password',
  'setup-mfa': 'Setup MFA',
  login: 'Masuk',
  logout: 'Keluar',
};

export function labelForSegment(segment: string): string {
  if (segmentLabels[segment]) return segmentLabels[segment];
  return segment
    .split('-')
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(' ');
}

export function canSeeNavItem(item: NavItem, role: UserRole | undefined): boolean {
  if (!item.roles || item.roles.length === 0) return true;
  return role !== undefined && item.roles.includes(role);
}

export function canSeeNavSection(section: NavSection, role: UserRole | undefined): boolean {
  if (!section.roles || section.roles.length === 0) return true;
  return role !== undefined && section.roles.includes(role);
}
