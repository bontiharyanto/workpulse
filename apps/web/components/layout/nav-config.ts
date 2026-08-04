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
 */
import type { UserRole } from '@workpulse/shared-types';
import {
  Activity,
  BarChart3,
  Bell,
  Calendar,
  CheckCheck,
  CheckCircle2,
  ClipboardList,
  Clock,
  FileSpreadsheet,
  KeyRound,
  Layers,
  LifeBuoy,
  LineChart,
  ScrollText,
  Settings,
  Shield,
  Sun,
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
  ],
};

export const adminSection: NavSection = {
  id: 'admin',
  label: 'Admin',
  roles: ADMIN_ROLES,
  items: [
    {
      href: '/admin/analytics',
      label: 'Analytics',
      icon: LineChart,
      module: 'admin',
      roles: ADMIN_ROLES,
    },
    { href: '/admin/users', label: 'Pengguna', icon: Users, module: 'admin', roles: ADMIN_ROLES },
    {
      href: '/admin/departments',
      label: 'Departemen',
      icon: Layers,
      module: 'admin',
      roles: ADMIN_ROLES,
    },
    { href: '/admin/shifts', label: 'Shift', icon: Calendar, module: 'admin', roles: ADMIN_ROLES },
    {
      href: '/admin/reports',
      label: 'Laporan',
      icon: BarChart3,
      module: 'admin',
      roles: ADMIN_ROLES,
    },
    {
      href: '/admin/webhooks',
      label: 'Webhooks',
      icon: Webhook,
      module: 'admin',
      roles: ADMIN_ROLES,
    },
    {
      href: '/admin/privacy',
      label: 'Privasi',
      icon: Shield,
      module: 'admin',
      roles: ADMIN_ROLES,
    },
    {
      href: '/admin/audit',
      label: 'Audit Log',
      icon: ScrollText,
      module: 'admin',
      roles: ADMIN_ROLES,
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

export const navSections: NavSection[] = [workspaceSection, approvalsSection, adminSection];

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
  users: 'Pengguna',
  departments: 'Departemen',
  shifts: 'Shift',
  reports: 'Laporan',
  webhooks: 'Webhooks',
  privacy: 'Privasi',
  audit: 'Audit Log',
  analytics: 'Analytics',
  ropa: 'ROPA',
  dpia: 'DPIA',
  retention: 'Retention',
  breaches: 'Pelanggaran',
  vendors: 'Vendor',
  security: 'Keamanan',
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
