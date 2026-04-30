"use client";

import React, { useEffect } from "react";

import type { NotificationRecord } from "@/lib/notifications";

interface NotificationCenterProps {
  open: boolean;
  notifications: NotificationRecord[];
  loading?: boolean;
  onOpenChange: (open: boolean) => void;
  onMarkAllRead: () => void | Promise<void>;
}

function getNotificationIcon(type: NotificationRecord["type"]) {
  switch (type) {
    case "rate_limit_warning":
      return "⚠️";
    case "usage_milestone":
      return "🎉";
    case "new_feature":
      return "🆕";
    case "key_rotated":
      return "🔑";
    default:
      return "👋";
  }
}

function formatTimestamp(value: string) {
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) {
    return "Just now";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(timestamp);
}

export function NotificationCenter({
  open,
  notifications,
  loading = false,
  onOpenChange,
  onMarkAllRead,
}: NotificationCenterProps) {
  const unreadCount = notifications.filter((notification) => !notification.read).length;

  useEffect(() => {
    if (!open) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onOpenChange(false);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onOpenChange, open]);

  return (
    <>
      <button
        type="button"
        onClick={() => onOpenChange(true)}
        className="relative inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-white/15 bg-white/10 text-white transition hover:bg-white/20 focus:outline-none focus:ring-2 focus:ring-white/70"
        aria-label={unreadCount > 0 ? `Open notifications, ${unreadCount} unread` : "Open notifications"}
      >
        <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.4-1.4a2 2 0 01-.6-1.4V11a6 6 0 10-12 0v3.2a2 2 0 01-.6 1.4L4 17h5m6 0a3 3 0 11-6 0m6 0H9" />
        </svg>
        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 inline-flex min-w-6 items-center justify-center rounded-full bg-amber-400 px-1.5 py-0.5 text-[11px] font-bold text-slate-950">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      <div
        className={`fixed inset-0 z-50 transition ${open ? "pointer-events-auto" : "pointer-events-none"}`}
        aria-hidden={open ? "false" : "true"}
      >
        <div
          className={`absolute inset-0 bg-slate-950/45 transition-opacity ${open ? "opacity-100" : "opacity-0"}`}
          onClick={() => onOpenChange(false)}
        />
        <aside
          className={`absolute right-0 top-0 flex h-full w-full max-w-md flex-col border-l border-slate-200 bg-white shadow-2xl transition-transform dark:border-slate-800 dark:bg-slate-950 ${open ? "translate-x-0" : "translate-x-full"}`}
          role="dialog"
          aria-modal="true"
          aria-labelledby="notification-center-title"
        >
          <div className="border-b border-slate-200 px-6 py-5 dark:border-slate-800">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                  Developer updates
                </p>
                <h2 id="notification-center-title" className="mt-2 text-xl font-semibold text-slate-900 dark:text-white">
                  Notification center
                </h2>
                <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                  Rate pressure, usage milestones, and product updates for this developer key.
                </p>
              </div>
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                className="rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-600 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-900"
              >
                Close
              </button>
            </div>
            <div className="mt-4 flex items-center justify-between gap-4">
              <p className="text-sm text-slate-500 dark:text-slate-400">
                {unreadCount > 0 ? `${unreadCount} unread notification${unreadCount === 1 ? "" : "s"}` : "All caught up"}
              </p>
              <button
                type="button"
                onClick={() => void onMarkAllRead()}
                disabled={unreadCount === 0}
                className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-900"
              >
                Mark all read
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-4">
            {loading ? (
              <div className="rounded-3xl border border-slate-200 bg-slate-50 px-5 py-10 text-center text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
                Loading notifications...
              </div>
            ) : notifications.length > 0 ? (
              <div className="space-y-3">
                {notifications.map((notification) => (
                  <article
                    key={notification.id}
                    className={`rounded-3xl border px-4 py-4 transition ${
                      notification.read
                        ? "border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950"
                        : "border-indigo-200 bg-indigo-50/80 dark:border-indigo-500/30 dark:bg-indigo-500/10"
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white text-lg shadow-sm dark:bg-slate-900">
                        <span aria-hidden="true">{getNotificationIcon(notification.type)}</span>
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                              {notification.title}
                            </h3>
                            <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
                              {notification.body}
                            </p>
                          </div>
                          {!notification.read && (
                            <span className="mt-1 h-2.5 w-2.5 flex-shrink-0 rounded-full bg-indigo-500" aria-label="Unread notification" />
                          )}
                        </div>
                        <p className="mt-3 text-xs uppercase tracking-[0.16em] text-slate-400">
                          {formatTimestamp(notification.createdAt)}
                        </p>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50 px-5 py-10 text-center dark:border-slate-700 dark:bg-slate-900">
                <div className="text-lg">🔔</div>
                <h3 className="mt-3 text-base font-semibold text-slate-900 dark:text-white">
                  No notifications yet
                </h3>
                <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                  This drawer will surface quota warnings, milestone wins, and new platform announcements.
                </p>
              </div>
            )}
          </div>
        </aside>
      </div>
    </>
  );
}

export default NotificationCenter;
