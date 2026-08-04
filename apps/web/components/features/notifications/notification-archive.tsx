'use client';

import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { Route } from 'next';
import Link from 'next/link';
import { useMemo, useState } from 'react';

import { ApiError, notificationsApi } from '@/lib/api-client';
import type { Notification } from '@workpulse/shared-types';

type Tab = 'all' | 'unread';

/**
 * Full-screen archive of the caller's notifications with cursor
 * pagination and a two-tab filter (semua / belum dibaca). Distinct
 * from the bell dropdown, which stays flat and un-paginated for
 * "quick peek" use.
 *
 * The unread filter mutates the queryKey so switching tabs starts a
 * fresh keyset walk — you can't smoothly transition an in-progress
 * page 5 from "all" to "unread" because the cursor's meaning changes.
 */
export function NotificationArchive(): JSX.Element {
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('all');

  const q = useInfiniteQuery({
    queryKey: ['notifications', 'archive', tab],
    queryFn: ({ pageParam }: { pageParam: string | undefined }) =>
      notificationsApi.listArchive({
        unreadOnly: tab === 'unread',
        limit: 25,
        cursor: pageParam,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  const rows: Notification[] = useMemo(
    () => (q.data?.pages ?? []).flatMap((p) => p.rows),
    [q.data],
  );

  /**
   * Optimistic mark-read. Same pattern as the bell dropdown: patch
   * every cached page + the unread-count query, roll back on error.
   */
  const markRead = useMutation({
    mutationFn: (id: string) => notificationsApi.markRead(id),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ['notifications', 'archive'] });
      const prev = qc.getQueriesData<{
        pages: { rows: Notification[]; nextCursor: string | null }[];
      }>({ queryKey: ['notifications', 'archive'] });
      qc.setQueriesData<{
        pages: { rows: Notification[]; nextCursor: string | null }[];
      }>({ queryKey: ['notifications', 'archive'] }, (data) => {
        if (!data) return data;
        return {
          ...data,
          pages: data.pages.map((p) => ({
            ...p,
            rows: p.rows.map((r) => (r.id === id ? { ...r, readAt: new Date().toISOString() } : r)),
          })),
        };
      });
      qc.setQueryData<{ unreadCount: number }>(['notifications', 'unread-count'], (curr) =>
        curr ? { unreadCount: Math.max(0, curr.unreadCount - 1) } : curr,
      );
      return { prev };
    },
    onError: (_err, _id, ctx) => {
      if (!ctx?.prev) return;
      for (const [key, data] of ctx.prev) {
        qc.setQueryData(key, data);
      }
      qc.invalidateQueries({ queryKey: ['notifications', 'unread-count'] });
    },
  });

  const markAllRead = useMutation({
    mutationFn: () => notificationsApi.markAllRead(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" className="inline-flex rounded-md border p-0.5">
          <TabButton active={tab === 'all'} onClick={() => setTab('all')}>
            Semua
          </TabButton>
          <TabButton active={tab === 'unread'} onClick={() => setTab('unread')}>
            Belum dibaca
          </TabButton>
        </div>
        <button
          type="button"
          className="border-input hover:bg-muted rounded-md border px-3 py-1.5 text-xs font-medium disabled:opacity-50"
          onClick={() => markAllRead.mutate()}
          disabled={markAllRead.isPending}
        >
          {markAllRead.isPending ? 'Memproses…' : 'Tandai semua dibaca'}
        </button>
      </div>

      {q.isError && (
        <p role="alert" className="text-destructive text-sm">
          Gagal memuat arsip:{' '}
          {q.error instanceof ApiError
            ? q.error.message
            : q.error instanceof Error
              ? q.error.message
              : 'unknown error'}
        </p>
      )}

      <section className="overflow-hidden rounded-lg border">
        {rows.length === 0 && !q.isLoading ? (
          <div className="text-muted-foreground p-8 text-center text-sm">
            {tab === 'unread' ? 'Semua notifikasi sudah dibaca.' : 'Belum ada notifikasi.'}
          </div>
        ) : (
          <ul className="divide-y">
            {q.isLoading && (
              <li className="text-muted-foreground p-4 text-center text-xs">Memuat…</li>
            )}
            {rows.map((n) => (
              <ArchiveRow key={n.id} notification={n} onMarkRead={(id) => markRead.mutate(id)} />
            ))}
          </ul>
        )}
      </section>

      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">
          {rows.length > 0 && `${rows.length} baris dimuat`}
        </span>
        {q.hasNextPage && (
          <button
            type="button"
            className="border-input hover:bg-muted rounded-md border px-3 py-2 text-xs font-medium disabled:opacity-50"
            onClick={() => void q.fetchNextPage()}
            disabled={q.isFetchingNextPage}
          >
            {q.isFetchingNextPage ? 'Memuat…' : 'Muat lebih banyak'}
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={
        active
          ? 'bg-foreground text-background rounded-sm px-3 py-1 text-xs font-medium'
          : 'text-muted-foreground hover:text-foreground rounded-sm px-3 py-1 text-xs font-medium'
      }
    >
      {children}
    </button>
  );
}

function ArchiveRow({
  notification,
  onMarkRead,
}: {
  notification: Notification;
  onMarkRead: (id: string) => void;
}): JSX.Element {
  const isUnread = !notification.readAt;
  const href =
    typeof notification.data?.href === 'string' ? (notification.data.href as string) : null;
  const inner = (
    <div className="flex items-start gap-3">
      <span
        aria-hidden
        className={`mt-1 inline-block h-2 w-2 rounded-full ${
          isUnread ? 'bg-primary' : 'bg-transparent'
        }`}
      />
      <div className="flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <p className={`text-sm ${isUnread ? 'font-semibold' : 'font-normal'}`}>
            {notification.title}
          </p>
          <span className="text-muted-foreground text-[10px] uppercase tracking-widest">
            {notification.type}
          </span>
        </div>
        <p className="text-muted-foreground mt-0.5 text-xs">{notification.body}</p>
        <p className="text-muted-foreground mt-1 text-[11px]">
          {formatTimestamp(notification.createdAt)}
          {notification.readAt && (
            <span className="ml-2 text-[10px]">
              · dibaca {formatTimestamp(notification.readAt)}
            </span>
          )}
        </p>
      </div>
    </div>
  );

  return (
    <li className="hover:bg-muted/40 flex items-start justify-between gap-2 px-4 py-3">
      {href ? (
        <Link
          href={href as Route}
          className="block flex-1"
          onClick={() => {
            if (isUnread) onMarkRead(notification.id);
          }}
        >
          {inner}
        </Link>
      ) : (
        <div className="flex-1">{inner}</div>
      )}
      {isUnread && (
        <button
          type="button"
          className="text-muted-foreground hover:text-foreground whitespace-nowrap text-[11px] underline underline-offset-2"
          onClick={() => onMarkRead(notification.id)}
        >
          Tandai dibaca
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
    hour: '2-digit',
    minute: '2-digit',
  });
}
