import { NotificationPreferencesForm } from '@/components/features/settings/notification-preferences';

export const metadata = { title: 'Pengaturan · Notifikasi' };

export default function NotificationSettingsPage(): JSX.Element {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">
          Preferensi Notifikasi
        </h1>
        <p className="text-sm text-muted-foreground">
          Atur channel pengiriman (in-app / email) untuk setiap jenis
          notifikasi. Semua tipe menyala secara default — matikan yang tidak
          Anda butuhkan.
        </p>
      </header>
      <NotificationPreferencesForm />
    </div>
  );
}
