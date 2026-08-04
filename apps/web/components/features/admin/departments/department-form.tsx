'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import type { Department } from '@workpulse/shared-types';
import { createDepartmentSchema, type CreateDepartmentInput } from '@workpulse/shared-types';

interface Props {
  parents: Department[];
  initial?: Department | null;
  submitting?: boolean;
  onSubmit: (values: CreateDepartmentInput) => void | Promise<void>;
  onCancel: () => void;
}

export function DepartmentForm({
  parents,
  initial,
  submitting,
  onSubmit,
  onCancel,
}: Props): JSX.Element {
  const form = useForm<CreateDepartmentInput>({
    resolver: zodResolver(createDepartmentSchema),
    defaultValues: {
      name: initial?.name ?? '',
      parentId: initial?.parentId ?? null,
    },
  });

  const selectableParents = parents.filter((p) => p.id !== initial?.id);

  return (
    <form
      onSubmit={form.handleSubmit((values) =>
        onSubmit({
          ...values,
          parentId: values.parentId ? values.parentId : null,
        }),
      )}
      className="space-y-4"
    >
      <div className="space-y-1">
        <label htmlFor="dept-name" className="text-xs font-medium uppercase tracking-wider">
          Nama Departemen
        </label>
        <input
          id="dept-name"
          {...form.register('name')}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          placeholder="Engineering"
        />
        {form.formState.errors.name && (
          <p className="text-xs text-destructive">{form.formState.errors.name.message}</p>
        )}
      </div>

      <div className="space-y-1">
        <label htmlFor="dept-parent" className="text-xs font-medium uppercase tracking-wider">
          Parent (opsional)
        </label>
        <select
          id="dept-parent"
          {...form.register('parentId')}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        >
          <option value="">— tidak ada —</option>
          {selectableParents.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border px-3 py-1 text-xs"
        >
          Batal
        </button>
        <button
          type="submit"
          disabled={submitting}
          className="rounded-md bg-foreground px-3 py-1 text-xs font-medium text-background disabled:opacity-50"
        >
          {submitting ? 'Menyimpan...' : initial ? 'Simpan perubahan' : 'Buat departemen'}
        </button>
      </div>
    </form>
  );
}
