'use client';

import { useState } from 'react';
import type { BulkImportHolidaysResponse, CreateHolidayInput } from '@workpulse/shared-types';
import { bulkImportHolidaysSchema } from '@workpulse/shared-types';

interface Props {
  submitting?: boolean;
  onSubmit: (items: CreateHolidayInput[]) => void | Promise<void>;
  onCancel: () => void;
  result?: BulkImportHolidaysResponse | null;
}

const EXAMPLE = `[
  { "date": "2026-01-01", "name": "Tahun Baru Masehi" },
  { "date": "2026-05-01", "name": "Hari Buruh Internasional" },
  { "date": "2026-08-17", "name": "Hari Kemerdekaan RI" }
]`;

export function HolidayBulkImport({ submitting, onSubmit, onCancel, result }: Props): JSX.Element {
  const [text, setText] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(): void {
    setError(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      setError(`JSON tidak valid: ${(e as Error).message}`);
      return;
    }

    // Accept either `[ ... ]` (list) or `{ items: [ ... ] }` (envelope).
    const items = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === 'object' && Array.isArray((parsed as { items?: unknown }).items)
        ? (parsed as { items: unknown[] }).items
        : null;

    if (!items) {
      setError('Format harus berupa array atau `{ items: [...] }`.');
      return;
    }

    const validation = bulkImportHolidaysSchema.safeParse({ items });
    if (!validation.success) {
      setError(validation.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
      return;
    }

    onSubmit(validation.data.items);
  }

  return (
    <div className="space-y-3 rounded-lg border p-4">
      <div>
        <h3 className="text-sm font-semibold">Bulk Import</h3>
        <p className="text-xs text-muted-foreground">
          Tempel array JSON berisi <code className="font-mono">{`{date, name}`}</code>. Duplikat
          (tanggal yang sudah ada di database) akan dilewati otomatis.
        </p>
      </div>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={10}
        placeholder={EXAMPLE}
        className="w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs"
      />

      {error && (
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          {error}
        </p>
      )}

      {result && (
        <p className="rounded-md border border-emerald-500/40 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-700">
          Berhasil menambahkan <strong>{result.inserted}</strong> hari libur.
          {result.skipped > 0 && ` ${result.skipped} dilewati (sudah ada / duplikat).`}
        </p>
      )}

      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="rounded-md border px-3 py-1 text-xs">
          Tutup
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={submitting || text.trim().length === 0}
          className="rounded-md bg-foreground px-3 py-1 text-xs font-medium text-background disabled:opacity-50"
        >
          {submitting ? 'Mengimpor...' : 'Impor'}
        </button>
      </div>
    </div>
  );
}
