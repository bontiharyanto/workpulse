'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Notification } from '@workpulse/shared-types';
import { Bell, CheckCheck } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { useState, type JSX } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ScrollArea } from '@/components/ui/scroll-area';
import { notificationsApi } from '@/lib/api-client';
import { cn } from '@/lib/utils';

/**
 * Notification bell rebuilt on Shadcn primitives — same data contract
 * as the previous `features/notifications/notification-bell.tsx`
 * (unread count poll + list-on-open + optimistic mark-read) but wired
 * into the Radix `DropdownMenu` so it composes with the topbar and
 * behaves correctly on focus / escape / outside-click.
 *
 * The old file is retained during Fase 2 for E2E stability; Fase 3
 * removes it once every consumer has migrated.
 */

const UNREAD_POLL_MS = 30_000;
const LIST_POLL_MS = 30_000;

export function NotificationBell(): JSX.Element {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

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
      void unread.refetch();
    },
    onSettled: () => {
      void unread.refetch();
    },
  });

  const markAllRead = useMutation({
    mutationFn: () => notificationsApi.markAllRead(),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  const count = unread.data?.unreadCount ?? 0;

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label={`Notifikasi (${count} belum dibaca)`}
        >
          <Bell />
          {count > 0 ? (
            <span
              aria-hidden
              className="bg-destructive text-destructive-foreground absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold leading-none"
            >
              {count > 99 ? '99+' : count}
            </span>
          ) : null}
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" sideOffset={8} className="w-96 p-0">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold">Notifikasi</span>
            {count > 0 ? <Badge variant="default">{count} baru</Badge> : null}
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => markAllRead.mutate()}
            disabled={count === 0 || markAllRead.isPending}
            className="h-7 text-xs"
          >
            <CheckCheck className="h-3.5 w-3.5" />
            Tandai semua
          </Button>
        </div>

        <ScrollArea className="max-h-96">
          {list.isLoading ? (
            <p className="text-muted-foreground p-6 text-center text-sm">Memuat…</p>
          ) : list.data && list.data.length > 0 ? (
            <ul>
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
            <p className="text-muted-foreground p-6 text-center text-sm">Belum ada notifikasi.</p>
          )}
        </ScrollArea>

        <div className="border-t p-2">
          <Button variant="ghost" size="sm" asChild className="w-full justify-center">
            <Link href="/notifications" onClick={() => setOpen(false)}>
              Lihat semua notifikasi
            </Link>
          </Button>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

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

  const body = (
    <div className="flex items-start gap-3 px-4 py-3">
      <span
        aria-hidden
        className={cn(
          'mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full transition-colors',
          isUnread ? 'bg-primary' : 'bg-transparent',
        )}
      />
      <div className="min-w-0 flex-1">
        <p className={cn('text-sm', isUnread ? 'font-semibold' : 'text-muted-foreground')}>
          {notification.title}
        </p>
        <p className="text-muted-foreground mt-0.5 line-clamp-2 text-xs">{notification.body}</p>
        <p className="text-muted-foreground mt-1 text-[11px]">{timestamp}</p>
      </div>
    </div>
  );

  return (
    <li className="hover:bg-muted/40 border-b transition-colors last:border-b-0">
      {href ? (
        <Link href={href as Route} className="block" onClick={handleClick}>
          {body}
        </Link>
      ) : (
        <button type="button" className="block w-full text-left" onClick={handleClick}>
          {body}
        </button>
      )}
    </li>
  );
}

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
