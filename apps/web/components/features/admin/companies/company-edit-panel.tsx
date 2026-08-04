'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import type { CompanyAdmin, UpdateCompanyInput } from '@workpulse/shared-types';
import { updateCompanyInputSchema } from '@workpulse/shared-types';

interface Props {
  target: CompanyAdmin;
  submitting?: boolean;
  onSubmit: (values: UpdateCompanyInput) => void | Promise<void>;
  onCancel: () => void;
}

/**
 * EDIT panel for an existing tenant. Server accepts any subset of
 * `{ name, slug, timezone }` so we only send the fields that actually
 * changed (mirrors the `CompanyConfigForm` diff logic — keeps the audit
 * log tidy).
 */
export function CompanyEditPanel({
  target,
  submitting,
  onSubmit,
  onCancel,
}: Props): JSX.Element {
  const form = useForm<{ name: string; slug: string; timezone: string }>({
    resolver: zodResolver(updateCompanyInputSchema),
    defaultValues: {
      name: target.name,
      slug: target.slug,
      timezone: target.timezone,
    },
  });

  const errors = form.formState.errors;

  return (
    <form
      onSubmit={form.handleSubmit((values) => {
        const patch: UpdateCompanyInput = {};
        if (values.name !== target.name) patch.name = values.name;
        if (values.slug !== target.slug) patch.slug = values.slug;
        if (values.timezone !== target.timezone) patch.timezone = values.timezone;
        if (Object.keys(patch).length === 0) {
          onCancel();
          return;
        }
        onSubmit(patch);
      })}
      className="grid gap-4 md:grid-cols-2"
    >
      <div className="space-y-1">
        <label className="text-xs font-medium uppercase tracking-wider">
          Nama Perusahaan
        </label>
        <input
          {...form.register('name')}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        />
        {errors.name && (
          <p className="text-xs text-destructive">{errors.name.message}</p>
        )}
      </div>

      <div className="space-y-1">
        <label className="text-xs font-medium uppercase tracking-wider">Slug</label>
        <input
          {...form.register('slug')}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono"
        />
        <p className="text-xs text-muted-foreground">
          Mengubah slug akan mempengaruhi URL yang bergantung padanya.
        </p>
        {errors.slug && (
          <p className="text-xs text-destructive">{errors.slug.message}</p>
        )}
      </div>

      <div className="space-y-1">
        <label className="text-xs font-medium uppercase tracking-wider">Timezone</label>
        <select
          {...form.register('timezone')}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        >
          <option value="Asia/Jakarta">Asia/Jakarta (WIB, UTC+7)</option>
          <option value="Asia/Makassar">Asia/Makassar (WITA, UTC+8)</option>
          <option value="Asia/Jayapura">Asia/Jayapura (WIT, UTC+9)</option>
        </select>
        {errors.timezone && (
          <p className="text-xs text-destructive">{errors.timezone.message}</p>
        )}
      </div>

      <div className="col-span-full flex justify-end gap-2 pt-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border px-3 py-1 text-xs"
        >
          Batal
        </button>
        <button
          type="submit"
          disabled={submitting || !form.formState.isDirty}
          className="rounded-md bg-foreground px-3 py-1 text-xs font-medium text-background disabled:opacity-50"
        >
          {submitting ? 'Menyimpan...' : 'Simpan perubahan'}
        </button>
      </div>
    </form>
  );
}
