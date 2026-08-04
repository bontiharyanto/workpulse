'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import type { CreateCompanyInput } from '@workpulse/shared-types';
import { createCompanyInputSchema } from '@workpulse/shared-types';

interface Props {
  submitting?: boolean;
  onSubmit: (values: CreateCompanyInput) => void | Promise<void>;
  onCancel: () => void;
}

/**
 * CREATE form for a new tenant. Slug is optional here — the API derives
 * one from `name` when omitted. Timezone falls back to `Asia/Jakarta`
 * server-side, but we surface the field so an operator onboarding an
 * eastern-Indonesia tenant can pick e.g. `Asia/Makassar` upfront.
 *
 * The initial HR user's credentials are submitted here but the temp
 * password itself is generated server-side and revealed once via
 * `<CredentialReveal>` after a successful response.
 */
export function CompanyForm({ submitting, onSubmit, onCancel }: Props): JSX.Element {
  const form = useForm<CreateCompanyInput>({
    resolver: zodResolver(createCompanyInputSchema),
    defaultValues: {
      name: '',
      slug: undefined,
      timezone: 'Asia/Jakarta',
      hrEmail: '',
      hrFullName: '',
    },
  });

  const errors = form.formState.errors;

  return (
    <form
      onSubmit={form.handleSubmit((values) => {
        const trimmedSlug = values.slug?.trim();
        onSubmit({
          ...values,
          slug: trimmedSlug ? trimmedSlug : undefined,
          timezone: values.timezone?.trim() || undefined,
        });
      })}
      className="grid gap-4 md:grid-cols-2"
    >
      <div className="space-y-1">
        <label className="text-xs font-medium uppercase tracking-wider">
          Nama Perusahaan
        </label>
        <input
          data-testid="company-name-input"
          {...form.register('name')}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        />
        {errors.name && (
          <p className="text-xs text-destructive">{errors.name.message}</p>
        )}
      </div>

      <div className="space-y-1">
        <label className="text-xs font-medium uppercase tracking-wider">
          Slug <span className="normal-case text-muted-foreground">(opsional)</span>
        </label>
        <input
          data-testid="company-slug-input"
          {...form.register('slug')}
          placeholder="acme"
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono"
        />
        <p className="text-xs text-muted-foreground">
          Huruf kecil, angka, atau tanda "-". Dibuat otomatis dari nama jika
          dikosongkan.
        </p>
        {errors.slug && (
          <p className="text-xs text-destructive">{errors.slug.message}</p>
        )}
      </div>

      <div className="space-y-1">
        <label className="text-xs font-medium uppercase tracking-wider">Timezone</label>
        <select
          data-testid="company-timezone-select"
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

      <div className="col-span-full">
        <div className="mt-2 border-t pt-4">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Akun HR Awal
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Akun ini akan menerima password sementara sekali pakai. Sistem akan
            memaksa mereka mengganti password pada login pertama.
          </p>
        </div>
      </div>

      <div className="space-y-1">
        <label className="text-xs font-medium uppercase tracking-wider">
          Nama HR
        </label>
        <input
          data-testid="hr-fullname-input"
          {...form.register('hrFullName')}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        />
        {errors.hrFullName && (
          <p className="text-xs text-destructive">{errors.hrFullName.message}</p>
        )}
      </div>

      <div className="space-y-1">
        <label className="text-xs font-medium uppercase tracking-wider">
          Email HR
        </label>
        <input
          type="email"
          autoComplete="off"
          data-testid="hr-email-input"
          {...form.register('hrEmail')}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        />
        {errors.hrEmail && (
          <p className="text-xs text-destructive">{errors.hrEmail.message}</p>
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
          disabled={submitting}
          data-testid="company-submit-btn"
          className="rounded-md bg-foreground px-3 py-1 text-xs font-medium text-background disabled:opacity-50"
        >
          {submitting ? 'Membuat...' : 'Buat tenant'}
        </button>
      </div>
    </form>
  );
}
