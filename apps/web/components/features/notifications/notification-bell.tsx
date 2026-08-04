'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Notification } from '@workpulse/shared-types';
import type { Route } from 'next';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

import { notificationsApi } from '@/lib/api-client';

/**
 * Notification bell + dropdown for the dashboard header.
 *
 * Design choices:
 *   - Unread count polls every 30s (cheap indexed count query). This is the
 *     "am I current?" heartbeat.
 *   - The list is only fetched when the dropdown is opened, then refetches
 *     on interval while it stays open. Closing the dropdown pauses polling.
 *   - "Mark as read" fires optimistically — the row is visually greyed out
 *     immediately and we roll back only if the API rejects.
 *   - No WebSocket / SSE — polling handles the load easily for MVP tenants.
 *     Upgrade path: replace `useUnreadCount` with an SSE subscription.
 */

const UNREAD_POLL_MS = 30_000;
const LIST_POLL_MS = 30_000;

export function NotificationBell(): JSX.Element {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const unread = useQuery({
    queryKey: ['notifications', 'unread-count'],
    queryFn: () => notificationsApi.unreadCount(),
    refetchInterval: UNREAD_POLL_MS,
    refetchOnWindowFocus: true,
  });

  const list = useQuery({
    queryKey: ['notifications', 'list'],
    queryFn: () => notificationsApi.list({ limit: 20 }),
    enabled: open,
    refetchInterval: open ? LIST_POLL_MS : false,
    staleTime: 10_000,
  });

  const markRead = useMutation({
    mutationFn: (id: string) => notificationsApi.markRead(id),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ['notifications', 'list'] });
      const prev = qc.getQueryData<Notification[]>(['notifications', 'list']);
      qc.setQueryData<Notification[]>(['notifications', 'list'], (rows) =>
        rows?.map((r) => (r.id === id ? { ...r, readAt: new Date().toISOString() } : r)),
      );
      qc.setQueryData<{ unreadCount: number }>(['notifications', 'unread-count'], (curr) =>
        curr ? { unreadCount: Math.max(0, curr.unreadCount - 1) } : curr,
      );
      return { prev };
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.prev) qc.setQueryData(['notifications', 'list'], ctx.prev);
      unread.refetch();
    },
    onSettled: () => {
      unread.refetch();
    },
  });

  const markAllRead = useMutation({
    mutationFn: () => notificationsApi.markAllRead(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  // Close dropdown on outside click. `mousedown` (not `click`) so we
  // don't race with in-dropdown link navigations.
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent): void => {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const count = unread.data?.unreadCount ?? 0;
  const badge = count > 99 ? '99+' : String(count);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={`Notifikasi (${count} belum dibaca)`}
        className="border-input text-muted-foreground hover:bg-muted relative flex h-8 w-8 items-center justify-center rounded-md border"
      >
        <BellIcon />
        {count > 0 ? (
          <span
            aria-hidden
            className="bg-primary text-primary-foreground absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold leading-none"
          >
            {badge}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          role="menu"
          aria-label="Notifikasi"
          className="bg-background absolute right-0 z-40 mt-2 w-96 rounded-md border shadow-lg"
        >
          <div className="flex items-center justify-between border-b px-3 py-2 text-sm">
            <span className="font-semibold">Notifikasi</span>
            <button
              type="button"
              onClick={() => markAllRead.mutate()}
              disabled={count === 0 || markAllRead.isPending}
              className="text-muted-foreground hover:text-foreground text-xs disabled:opacity-40"
            >
              Tandai semua dibaca
            </button>
          </div>

          <div className="max-h-96 overflow-y-auto">
            {list.isLoading ? (
              <div className="text-muted-foreground p-4 text-sm">Memuat...</div>
            ) : list.data && list.data.length > 0 ? (
              <ul className="divide-y">
                {list.data.map((n) => (
                  <NotificationRow
                    key={n.id}
                    notification={n}
                    onMarkRead={(id) => markRead.mutate(id)}
                    onNavigate={() => setOpen(false)}
                  />
                ))}
              </ul>
            ) : (
              <div className="text-muted-foreground p-6 text-center text-sm">
                Belum ada notifikasi.
              </div>
            )}
          </div>

          <div className="border-t px-3 py-2 text-center">
            <Link
              href="/notifications"
              onClick={() => setOpen(false)}
              className="text-primary text-xs font-medium hover:underline"
            >
              Lihat semua notifikasi →
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------

interface RowProps {
  notification: Notification;
  onMarkRead: (id: string) => void;
  onNavigate: () => void;
}

function NotificationRow({ notification, onMarkRead, onNavigate }: RowProps): JSX.Element {
  const isUnread = !notification.readAt;
  const href =
    typeof notification.data?.href === 'string' ? (notification.data.href as string) : null;
  const timestamp = formatTimestamp(notification.createdAt);

  const handleClick = (): void => {
    if (isUnread) onMarkRead(notification.id);
    if (href) onNavigate();
  };

  const inner = (
    <div className="flex items-start gap-2">
      <span
        aria-hidden
        className={`mt-1 inline-block h-2 w-2 rounded-full ${
          isUnread ? 'bg-primary' : 'bg-transparent'
        }`}
      />
      <div className="flex-1">
        <p className={`text-sm ${isUnread ? 'font-semibold' : 'font-normal'}`}>
          {notification.title}
        </p>
        <p className="text-muted-foreground mt-0.5 line-clamp-2 text-xs">{notification.body}</p>
        <p className="text-muted-foreground mt-1 text-[11px]">{timestamp}</p>
      </div>
    </div>
  );

  return (
    <li className="hover:bg-muted/60 px-3 py-2">
      {href ? (
        <Link href={href as Route} className="block" onClick={handleClick}>
          {inner}
        </Link>
      ) : (
        <button type="button" className="block w-full text-left" onClick={handleClick}>
          {inner}
        </button>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Very small "N minutes ago" formatter. Kept inline to avoid pulling in
 * date-fns for what is effectively one cell in a dropdown.
 */
function formatTimestamp(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffMs = now - then;
  const min = Math.round(diffMs / 60_000);
  if (min < 1) return 'Baru saja';
  if (min < 60) return `${min} menit lalu`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} jam lalu`;
  const day = Math.round(hr / 24);
  if (day < 7) return `${day} hari lalu`;
  return new Date(iso).toLocaleDateString('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function BellIcon(): JSX.Element {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
      aria-hidden
    >
      <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </svg>
  );
}
