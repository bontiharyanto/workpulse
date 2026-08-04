import Link from 'next/link';

import { NotificationArchive } from '@/components/features/notifications/notification-archive';

export const metadata = { title: 'Notifikasi' };

export default function NotificationsPage(): JSX.Element {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Notifikasi</h1>
          <p className="text-muted-foreground text-sm">
            Riwayat notifikasi Anda. Gunakan tab &ldquo;Belum dibaca&rdquo; untuk fokus ke yang
            belum ditinjau, atau atur preferensi per-tipe di halaman{' '}
            <Link
              href="/settings/notifications"
              className="text-primary font-medium hover:underline"
            >
              pengaturan notifikasi
            </Link>
            .
          </p>
        </div>
      </header>
      <NotificationArchive />
    </div>
  );
}
