'use client';

import { useState } from 'react';

interface Props {
  email: string;
  temporaryPassword: string;
  onDismiss: () => void;
  title?: string;
}

/**
 * Modal-like inline panel that surfaces a one-time temporary password.
 * The password is intentionally hidden by default (masked) and revealed on
 * demand; a "copy" button reduces the chance of it being screenshotted.
 * Once dismissed the value CANNOT be recovered from the API — audit trail
 * records that a temp password was issued, but never stores the plaintext.
 */
export function CredentialReveal({
  email,
  temporaryPassword,
  onDismiss,
  title = 'Password sementara telah dibuat',
}: Props): JSX.Element {
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(temporaryPassword);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // no-op — user can copy manually after revealing
    }
  }

  return (
    <div
      role="alertdialog"
      aria-labelledby="cred-reveal-title"
      className="rounded-lg border border-amber-500/40 bg-amber-50 p-4 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-100"
    >
      <p id="cred-reveal-title" className="font-medium">
        {title}
      </p>
      <p className="mt-1 text-xs">
        Password ini hanya ditampilkan sekali. Kirim ke pengguna melalui kanal
        aman (misalnya password manager, jangan lewat email biasa). Sistem akan
        <strong> otomatis memaksa mereka mengubah password </strong> pada login
        pertama sebelum bisa mengakses aplikasi.
      </p>

      <dl className="mt-3 space-y-2 rounded-md bg-white/60 p-3 dark:bg-black/20">
        <div className="flex items-center justify-between gap-2">
          <dt className="text-xs uppercase tracking-wider text-muted-foreground">Email</dt>
          <dd className="font-mono text-xs">{email}</dd>
        </div>
        <div className="flex items-center justify-between gap-2">
          <dt className="text-xs uppercase tracking-wider text-muted-foreground">Password</dt>
          <dd className="flex items-center gap-2">
            <span className="font-mono text-sm tabular-nums">
              {revealed ? temporaryPassword : '•'.repeat(temporaryPassword.length)}
            </span>
            <button
              type="button"
              onClick={() => setRevealed((v) => !v)}
              className="rounded-md border px-2 py-1 text-xs hover:bg-black/5"
            >
              {revealed ? 'Sembunyikan' : 'Tampilkan'}
            </button>
            <button
              type="button"
              onClick={() => void copy()}
              className="rounded-md border px-2 py-1 text-xs hover:bg-black/5"
            >
              {copied ? 'Tersalin' : 'Salin'}
            </button>
          </dd>
        </div>
      </dl>

      <div className="mt-3 flex justify-end">
        <button
          type="button"
          onClick={onDismiss}
          className="rounded-md bg-amber-600 px-3 py-1 text-xs font-medium text-white hover:opacity-90"
        >
          Saya sudah mencatat, tutup
        </button>
      </div>
    </div>
  );
}
