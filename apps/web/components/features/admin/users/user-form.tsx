'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import type { AdminUser, CreateUserInput, Department, UserRole } from '@workpulse/shared-types';
import { createUserSchema } from '@workpulse/shared-types';

const ROLE_LABELS: Record<UserRole, string> = {
  EMPLOYEE: 'Employee',
  SUPERVISOR: 'Supervisor',
  HR_MANAGER: 'HR Manager',
  SUPER_ADMIN: 'Super Admin',
};

interface Props {
  actorRole: UserRole;
  departments: Department[];
  potentialSupervisors: AdminUser[];
  submitting?: boolean;
  onSubmit: (values: CreateUserInput) => void | Promise<void>;
  onCancel: () => void;
}

/**
 * Only used for the CREATE flow (edit is handled by UserEditPanel).
 * Kept intentionally simple: no random-password preview here since the temp
 * password is generated server-side and revealed via CredentialReveal after
 * a successful POST.
 */
export function UserForm({
  actorRole,
  departments,
  potentialSupervisors,
  submitting,
  onSubmit,
  onCancel,
}: Props): JSX.Element {
  const assignableRoles: UserRole[] =
    actorRole === 'SUPER_ADMIN'
      ? ['EMPLOYEE', 'SUPERVISOR', 'HR_MANAGER', 'SUPER_ADMIN']
      : ['EMPLOYEE', 'SUPERVISOR', 'HR_MANAGER'];

  const form = useForm<CreateUserInput>({
    resolver: zodResolver(createUserSchema),
    defaultValues: {
      email: '',
      fullName: '',
      role: 'EMPLOYEE',
      departmentId: null,
      supervisorId: null,
      hiredAt: new Date().toISOString().slice(0, 10),
    },
  });

  return (
    <form
      onSubmit={form.handleSubmit((values) =>
        onSubmit({
          ...values,
          departmentId: values.departmentId ? values.departmentId : null,
          supervisorId: values.supervisorId ? values.supervisorId : null,
        }),
      )}
      className="grid gap-4 md:grid-cols-2"
    >
      <div className="space-y-1">
        <label className="text-xs font-medium uppercase tracking-wider">Nama Lengkap</label>
        <input
          {...form.register('fullName')}
          className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
        />
        {form.formState.errors.fullName && (
          <p className="text-destructive text-xs">{form.formState.errors.fullName.message}</p>
        )}
      </div>

      <div className="space-y-1">
        <label className="text-xs font-medium uppercase tracking-wider">Email</label>
        <input
          type="email"
          autoComplete="off"
          {...form.register('email')}
          className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
        />
        {form.formState.errors.email && (
          <p className="text-destructive text-xs">{form.formState.errors.email.message}</p>
        )}
      </div>

      <div className="space-y-1">
        <label className="text-xs font-medium uppercase tracking-wider">Role</label>
        <select
          {...form.register('role')}
          className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
        >
          {assignableRoles.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r]}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-1">
        <label className="text-xs font-medium uppercase tracking-wider">Tanggal Bergabung</label>
        <input
          type="date"
          {...form.register('hiredAt')}
          className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
        />
        {form.formState.errors.hiredAt && (
          <p className="text-destructive text-xs">{form.formState.errors.hiredAt.message}</p>
        )}
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
          {potentialSupervisors.map((u) => (
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
          {submitting ? 'Membuat...' : 'Buat karyawan'}
        </button>
      </div>
    </form>
  );
}
