import type { JSX } from 'react';

import { NotificationPreferencesForm } from '@/components/features/settings/notification-preferences';

export const metadata = { title: 'Pengaturan · Notifikasi' };

export default function NotificationSettingsPage(): JSX.Element {
  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h2 className="text-h4 text-foreground tracking-tight">Preferensi Notifikasi</h2>
        <p className="text-muted-foreground text-body">
          Atur channel pengiriman (in-app / email) untuk setiap jenis notifikasi. Semua tipe
          menyala secara default — matikan yang tidak Anda butuhkan.
        </p>
      </header>
      <NotificationPreferencesForm />
    </div>
  );
}
