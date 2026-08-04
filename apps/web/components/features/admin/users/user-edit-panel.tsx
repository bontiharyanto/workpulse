'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import type { AdminUser, Department, UpdateUserInput, UserRole } from '@workpulse/shared-types';
import { updateUserSchema } from '@workpulse/shared-types';
import { useForm } from 'react-hook-form';

const ROLE_LABELS: Record<UserRole, string> = {
  EMPLOYEE: 'Employee',
  SUPERVISOR: 'Supervisor',
  HR_MANAGER: 'HR Manager',
  SUPER_ADMIN: 'Super Admin',
};

interface Props {
  actorId: string;
  actorRole: UserRole;
  target: AdminUser;
  departments: Department[];
  potentialSupervisors: AdminUser[];
  submitting?: boolean;
  onSubmit: (values: UpdateUserInput) => void | Promise<void>;
  onCancel: () => void;
}

export function UserEditPanel({
  actorId,
  actorRole,
  target,
  departments,
  potentialSupervisors,
  submitting,
  onSubmit,
  onCancel,
}: Props): JSX.Element {
  const isSelf = actorId === target.id;
  const assignableRoles: UserRole[] =
    actorRole === 'SUPER_ADMIN'
      ? ['EMPLOYEE', 'SUPERVISOR', 'HR_MANAGER', 'SUPER_ADMIN']
      : ['EMPLOYEE', 'SUPERVISOR', 'HR_MANAGER'];

  const form = useForm<UpdateUserInput>({
    resolver: zodResolver(updateUserSchema),
    defaultValues: {
      fullName: target.fullName,
      role: target.role,
      departmentId: target.departmentId,
      supervisorId: target.supervisorId,
      employmentStatus: target.employmentStatus,
    },
  });

  return (
    <form
      onSubmit={form.handleSubmit((values) => {
        const cleaned: UpdateUserInput = {
          ...values,
          departmentId: values.departmentId === '' ? null : values.departmentId,
          supervisorId: values.supervisorId === '' ? null : values.supervisorId,
        };
        return onSubmit(cleaned);
      })}
      className="grid gap-4 md:grid-cols-2"
    >
      <div className="space-y-1">
        <label className="text-xs font-medium uppercase tracking-wider">Nama Lengkap</label>
        <input
          {...form.register('fullName')}
          className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
        />
      </div>

      <div className="space-y-1">
        <label className="text-xs font-medium uppercase tracking-wider">Email</label>
        <input
          value={target.email}
          disabled
          className="border-input bg-muted/40 text-muted-foreground w-full rounded-md border px-3 py-2 text-sm"
        />
      </div>

      <div className="space-y-1">
        <label className="text-xs font-medium uppercase tracking-wider">Role</label>
        <select
          {...form.register('role')}
          disabled={isSelf}
          title={isSelf ? 'Anda tidak dapat mengubah role sendiri' : undefined}
          className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm disabled:opacity-60"
        >
          {assignableRoles.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r]}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-1">
        <label className="text-xs font-medium uppercase tracking-wider">Status</label>
        <select
          {...form.register('employmentStatus')}
          disabled={isSelf}
          className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm disabled:opacity-60"
        >
          <option value="ACTIVE">Active</option>
          <option value="ON_LEAVE">On Leave</option>
          <option value="SUSPENDED">Suspended</option>
          <option value="TERMINATED">Terminated</option>
        </select>
      </div>

      <div className="space-y-1">
        <label className="text-xs font-medium uppercase tracking-wider">Departemen</label>
        <select
          {...form.register('departmentId')}
          className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
        >
          <option value="">— tidak ada —</option>
          {departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-1">
        <label className="text-xs font-medium uppercase tracking-wider">Atasan Langsung</label>
        <select
          {...form.register('supervisorId')}
          className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
        >
          <option value="">— tidak ada —</option>
          {potentialSupervisors
            .filter((u) => u.id !== target.id)
            .map((u) => (
              <option key={u.id} value={u.id}>
                {u.fullName} · {ROLE_LABELS[u.role]}
              </option>
            ))}
        </select>
      </div>

      <div className="col-span-full flex justify-end gap-2 pt-2">
        <button type="button" onClick={onCancel} className="rounded-md border px-3 py-1 text-xs">
          Batal
        </button>
        <button
          type="submit"
          disabled={submitting}
          className="bg-foreground text-background rounded-md px-3 py-1 text-xs font-medium disabled:opacity-50"
        >
          {submitting ? 'Menyimpan...' : 'Simpan perubahan'}
        </button>
      </div>
    </form>
  );
}
