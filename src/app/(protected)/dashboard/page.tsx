"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import NotificationCenter from "@/components/NotificationCenter";
import DashboardSidebar from "@/components/dashboard/DashboardSidebar";
import {
  BILLING_TIER_UI,
  canonicalizeBillingTier,
  type BillingTierName,
  type CanonicalBillingTierName,
} from "@/lib/billing";
import { persistDeveloperSession } from "@/lib/developer-session";
import {
  buildLocalDashboardNotifications,
  mergeNotifications,
  type NotificationRecord,
} from "@/lib/notifications";

interface DeveloperProfile {
  id: string;
  email: string;
  plan: string;
  created_at: string;
}

interface ApiKeySummary {
  id: string;
  name: string;
  tier: string;
  is_active: boolean;
  created_at: string;
  last_used_at: string | null;
  expires_at: string | null;
}

interface UsageSummary {
  requests_today: number;
  requests_this_month: number;
  rate_limit_hits: number;
  top_5_queries: { query: string; count: number }[];
}

interface DeveloperPortalData {
  developer: DeveloperProfile;
  api_keys: ApiKeySummary[];
  total_keys: number;
  requests_today: number;
  daily_limit: number;
  requests_this_month: number;
  monthly_limit: number;
  reset_at: string;
  usage: UsageSummary;
}

interface UsageDay {
  date: string;
  request_count: number;
}

interface DashboardUsageData {
  tier: BillingTierName;
  limit: number;
  usage_today: number;
  usage_remaining: number;
  daily_usage: UsageDay[];
  billing?: {
    requests_limit?: number;
  } | null;
  rate_limit?: {
    requests_per_minute: number | null;
    requests_per_day: number;
  };
}

interface SubscriptionSummary {
  tier: BillingTierName;
  plan_name: string;
  subscription_status: string | null;
  current_period_end: string | null;
  requests_limit: number;
  requests_remaining: number;
}

interface RotationResult {
  newKey: string;
  previousKey: string;
  oldKeyExpiresAt: string;
}

interface NotificationsResponse {
  notifications: NotificationRecord[];
  unread_count: number;
}

const LOCAL_NOTIFICATION_READS_KEY = "bw_dashboard_notification_reads";

const TIER_LIMITS: Record<CanonicalBillingTierName, number> = {
  free: 100,
  pro: 50000,
  scale: 200000,
};

function formatResetTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "the next quota reset";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(date);
}

function obfuscateApiKey(value: string) {
  if (value.length <= 12) {
    return value;
  }

  return `${value.slice(0, 11)}...${value.slice(-4)}`;
}

function formatChartDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(date);
}

function formatRelativeTimeRemaining(value: string, now: number) {
  const expiresAt = new Date(value).getTime();
  if (Number.isNaN(expiresAt)) {
    return null;
  }

  const remainingMs = expiresAt - now;
  if (remainingMs <= 0) {
    return "Expired";
  }

  const totalSeconds = Math.floor(remainingMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes.toString().padStart(2, "0")}m ${seconds
      .toString()
      .padStart(2, "0")}s`;
  }

  return `${minutes.toString().padStart(2, "0")}m ${seconds
    .toString()
    .padStart(2, "0")}s`;
}

function UsageProgressBar({ used, limit, label }: { used: number; limit: number; label: string }) {
  const pct = limit > 0 ? Math.min((used / limit) * 100, 100) : 0;
  const color = pct > 90 ? "bg-red-500" : pct > 70 ? "bg-amber-500" : "bg-indigo-500";

  return (
    <div>
      <div className="mb-1 flex justify-between text-xs text-slate-500 dark:text-slate-400">
        <span>{label}</span>
        <span>{used.toLocaleString()} / {limit.toLocaleString()}</span>
      </div>
      <div
        className="h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={limit}
        aria-valuenow={Math.min(used, limit)}
      >
        <div
          className={`h-full rounded-full transition-all ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function CopyButton({
  text,
  label,
  className = "",
}: {
  text: string;
  label: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        });
      }}
      aria-label={copied ? `${label} copied` : `Copy ${label}`}
      className={className}
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

function UsageChart({ days }: { days: UsageDay[] }) {
  const normalizedDays = days.slice(-7);
  const maxRequests = Math.max(...normalizedDays.map((day) => day.request_count), 1);

  if (normalizedDays.length === 0) {
    return (
      <p className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-500 dark:bg-slate-900 dark:text-slate-400">
        No seven-day usage history yet. Requests will appear here once this key starts serving traffic.
      </p>
    );
  }

  return (
    <div>
      <div
        className="grid h-52 grid-cols-7 items-end gap-3"
        role="img"
        aria-label="Bar chart showing the last seven days of API request volume"
      >
        {normalizedDays.map((day) => {
          const barHeight = Math.max((day.request_count / maxRequests) * 100, day.request_count > 0 ? 10 : 4);

          return (
            <div key={day.date} className="flex h-full flex-col items-center justify-end gap-3">
              <div className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                {day.request_count.toLocaleString()}
              </div>
              <div className="flex h-36 w-full items-end rounded-2xl bg-slate-100 px-2 py-2 dark:bg-slate-900">
                <div
                  className="w-full rounded-xl bg-[linear-gradient(180deg,#2563eb_0%,#1d4ed8_100%)]"
                  style={{ height: `${barHeight}%` }}
                />
              </div>
              <div className="text-center text-xs text-slate-500 dark:text-slate-400">
                {formatChartDate(day.date)}
              </div>
            </div>
          );
        })}
      </div>
      <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">
        Seven-day request history for the active developer key.
      </p>
    </div>
  );
}

export default function DashboardPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [apiKey, setApiKey] = useState("");
  const [portal, setPortal] = useState<DeveloperPortalData | null>(null);
  const [usage, setUsage] = useState<DashboardUsageData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rotating, setRotating] = useState(false);
  const [rotateError, setRotateError] = useState<string | null>(null);
  const [rotation, setRotation] = useState<RotationResult | null>(null);
  const [notificationCenterOpen, setNotificationCenterOpen] = useState(false);
  const [serverNotifications, setServerNotifications] = useState<NotificationRecord[]>([]);
  const [locallyReadNotificationIds, setLocallyReadNotificationIds] = useState<string[]>([]);
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const [subscription, setSubscription] = useState<SubscriptionSummary | null>(null);
  const [now, setNow] = useState(Date.now());

  async function loadDashboard(key: string) {
    setLoading(true);
    setNotificationsLoading(true);
    setError(null);

    try {
      const [portalResponse, usageResponse, notificationsResponse, subscriptionResponse] = await Promise.all([
        fetch("/api/dashboard/developer-portal", {
          headers: { "x-api-key": key },
        }),
        fetch("/api/dashboard/usage", {
          headers: { "x-api-key": key },
        }),
        fetch("/api/v1/developer/notifications", {
          headers: { "x-api-key": key },
        }),
        fetch("/api/v1/stripe/subscription", {
          credentials: "include",
          headers: { "x-api-key": key },
        }),
      ]);

      if (!portalResponse.ok || !usageResponse.ok || !notificationsResponse.ok || !subscriptionResponse.ok) {
        throw new Error("Failed to load developer portal");
      }

      const [portalPayload, usagePayload, notificationsPayload, subscriptionPayload] = await Promise.all([
        portalResponse.json() as Promise<DeveloperPortalData>,
        usageResponse.json() as Promise<DashboardUsageData>,
        notificationsResponse.json() as Promise<NotificationsResponse>,
        subscriptionResponse.json() as Promise<SubscriptionSummary>,
      ]);

      setPortal(portalPayload);
      setUsage(usagePayload);
      setServerNotifications(notificationsPayload.notifications);
      setSubscription(subscriptionPayload);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to load developer portal"
      );
    } finally {
      setLoading(false);
      setNotificationsLoading(false);
    }
  }

  async function handleRotateKey() {
    if (!apiKey) {
      return;
    }

    const fallbackKeyId = portal?.api_keys.find((entry) => entry.is_active)?.id ?? portal?.api_keys[0]?.id;
    if (!fallbackKeyId) {
      setRotateError("No active key was available to rotate.");
      return;
    }

    setRotating(true);
    setRotateError(null);

    try {
      const response = await fetch("/api/dashboard/rotate-key", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
        },
        body: JSON.stringify({ keyId: fallbackKeyId }),
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.raw_key) {
        throw new Error(payload?.error ?? "Unable to rotate this API key right now.");
      }

      await persistDeveloperSession(payload.raw_key);
      setRotation({
        newKey: payload.raw_key,
        previousKey: apiKey,
        oldKeyExpiresAt: payload.old_key_expires_at ?? new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      });
      setApiKey(payload.raw_key);
      await loadDashboard(payload.raw_key);
    } catch (err) {
      setRotateError(
        err instanceof Error ? err.message : "Unable to rotate this API key right now."
      );
    } finally {
      setRotating(false);
    }
  }

  useEffect(() => {
    const stored = localStorage.getItem("bw_api_key");
    const storedReads = localStorage.getItem(LOCAL_NOTIFICATION_READS_KEY);

    if (storedReads) {
      try {
        setLocallyReadNotificationIds(JSON.parse(storedReads) as string[]);
      } catch {
        setLocallyReadNotificationIds([]);
      }
    }

    if (stored) {
      setApiKey(stored);
      void loadDashboard(stored);
    }
  }, []);

  useEffect(() => {
    const sessionId = searchParams?.get("session_id");
    if (sessionId) {
      router.replace(`/checkout/success?session_id=${encodeURIComponent(sessionId)}`);
    }
  }, [router, searchParams]);

  useEffect(() => {
    if (!rotation?.oldKeyExpiresAt) {
      return;
    }

    const interval = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);

    return () => window.clearInterval(interval);
  }, [rotation?.oldKeyExpiresAt]);

  const tier = canonicalizeBillingTier(subscription?.tier ?? portal?.developer.plan ?? portal?.api_keys[0]?.tier ?? usage?.tier);
  const tierInfo = BILLING_TIER_UI[tier] ?? BILLING_TIER_UI.free;
  const tierLimit = subscription?.requests_limit ?? usage?.billing?.requests_limit ?? usage?.limit ?? TIER_LIMITS[tier] ?? TIER_LIMITS.free;
  const requestsToday = usage?.usage_today ?? portal?.requests_today ?? 0;
  const requestsThisMonth = portal?.usage.requests_this_month ?? portal?.requests_this_month ?? 0;
  const dailyLimit = usage?.rate_limit?.requests_per_day ?? portal?.daily_limit ?? tierLimit;
  const usagePercent = dailyLimit > 0 ? Math.min((requestsToday / dailyLimit) * 100, 100) : 0;
  const requestsPerMinute = usage?.rate_limit?.requests_per_minute;
  const usageWindow = usage?.daily_usage?.slice(-7) ?? [];
  const topQueries = portal?.usage.top_5_queries ?? [];
  const resetLabel = portal ? formatResetTime(portal.reset_at) : "the next quota reset";
  const oldKeyCountdown = rotation ? formatRelativeTimeRemaining(rotation.oldKeyExpiresAt, now) : null;
  const localNotifications = buildLocalDashboardNotifications({
    tier,
    requestsToday,
    dailyLimit,
    requestsThisMonth,
    rateLimitHits: portal?.usage.rate_limit_hits ?? 0,
    rotationExpiresAt: rotation?.oldKeyExpiresAt ?? null,
    now,
  });
  const notifications = mergeNotifications(
    serverNotifications,
    localNotifications,
    locallyReadNotificationIds
  );
  const mcpSnippet = apiKey
    ? `{
  "mcpServers": {
    "buywhere": {
      "command": "npx",
      "args": ["-y", "@buywhere/mcp"],
      "env": {
        "BUYWHERE_API_KEY": "${apiKey}"
      }
    }
  }
}`
    : "";

  async function handleMarkAllNotificationsRead() {
    const localIds = localNotifications.map((notification) => notification.id);
    const nextLocalIds = Array.from(new Set([...locallyReadNotificationIds, ...localIds]));

    setLocallyReadNotificationIds(nextLocalIds);
    localStorage.setItem(LOCAL_NOTIFICATION_READS_KEY, JSON.stringify(nextLocalIds));
    setServerNotifications((current) =>
      current.map((notification) => ({
        ...notification,
        read: true,
      }))
    );

    if (!apiKey) {
      return;
    }

    setNotificationsLoading(true);

    try {
      await fetch("/api/v1/developer/notifications/read", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
        },
        body: JSON.stringify({ all: true }),
      });
    } finally {
      setNotificationsLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-white text-slate-950 dark:bg-slate-950 dark:text-slate-50">
      <Nav />

      <section className="border-b border-slate-200 bg-[radial-gradient(circle_at_top_left,_rgba(255,255,255,0.18),_transparent_34%),linear-gradient(135deg,#312e81_0%,#1d4ed8_58%,#0f172a_100%)] py-14 text-white dark:border-slate-800">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-indigo-100">
                Developer dashboard
              </div>
              <h1 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">
                Manage your BuyWhere key without leaving the product.
              </h1>
              <p className="mt-3 max-w-2xl text-sm leading-7 text-indigo-100 sm:text-base">
                Rotate credentials safely, watch quota pressure build, and keep integration resources close at hand.
              </p>
            </div>
            {portal && (
              <div className="flex items-center gap-3 self-start lg:self-auto">
                <NotificationCenter
                  open={notificationCenterOpen}
                  notifications={notifications}
                  loading={notificationsLoading}
                  onOpenChange={setNotificationCenterOpen}
                  onMarkAllRead={handleMarkAllNotificationsRead}
                />
                <div className="rounded-2xl border border-white/15 bg-white/10 px-5 py-4 backdrop-blur">
                  <div className="text-xs uppercase tracking-[0.16em] text-indigo-100/80">
                    Signed in as
                  </div>
                  <div className="mt-2 text-sm font-semibold text-white">
                    {portal.developer.email}
                  </div>
                  <div className="mt-2 inline-flex items-center rounded-full bg-white/15 px-3 py-1 text-xs font-medium text-white">
                    {tierInfo.label} tier
                  </div>
                  <div className="mt-2 inline-flex items-center rounded-full border border-white/15 bg-slate-950/20 px-3 py-1 text-xs font-medium text-indigo-50">
                    {subscription?.subscription_status === "active" ? "Subscription active" : `${subscription?.plan_name ?? tierInfo.label} plan`}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="flex-1 bg-slate-50 py-10 dark:bg-slate-950">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="space-y-6 xl:grid xl:grid-cols-[240px_minmax(0,1fr)] xl:items-start xl:gap-6 xl:space-y-0">
            <DashboardSidebar />
            <div className="space-y-6">
              {!apiKey ? (
            <div className="mx-auto max-w-3xl rounded-[28px] border border-slate-200 bg-white p-8 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:p-10">
              <div className="inline-flex items-center rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
                Session required
              </div>
              <h2 className="mt-4 text-2xl font-bold text-slate-900 dark:text-white">
                No developer key is stored on this device yet.
              </h2>
              <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-600 dark:text-slate-300">
                Sign in with an existing key or create a new one before you use the dashboard.
              </p>
              <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                <Link
                  href="/login?next=%2Fdashboard"
                  className="inline-flex items-center justify-center rounded-xl bg-indigo-600 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-indigo-700"
                >
                  Sign in with API key
                </Link>
                <Link
                  href="/api-keys"
                  className="inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
                >
                  Create API key
                </Link>
              </div>
            </div>
              ) : loading ? (
            <div className="flex items-center justify-center py-20">
              <div className="flex items-center gap-3 text-slate-500 dark:text-slate-400">
                <svg className="h-5 w-5 animate-spin" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Loading dashboard...
              </div>
            </div>
              ) : error ? (
            <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center dark:border-red-500/30 dark:bg-red-500/10">
              <p className="mb-2 font-medium text-red-700 dark:text-red-300">Failed to load developer portal</p>
              <p className="text-sm text-red-600 dark:text-red-200">{error}</p>
              <button
                type="button"
                onClick={() => loadDashboard(apiKey)}
                className="mt-4 text-sm text-indigo-600 hover:underline dark:text-indigo-300"
              >
                Try again
              </button>
            </div>
              ) : (
            <div className="space-y-6">
              {rotation && (
                <div className="rounded-[28px] border border-emerald-200 bg-emerald-50 p-6 shadow-sm dark:border-emerald-500/30 dark:bg-emerald-500/10">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="max-w-2xl">
                      <div className="inline-flex rounded-full bg-white px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-200">
                        Rotation complete
                      </div>
                      <h2 className="mt-4 text-2xl font-bold text-slate-900 dark:text-white">
                        Your new key is active now.
                      </h2>
                      <p className="mt-3 text-sm leading-7 text-slate-700 dark:text-slate-300">
                        Store the new key securely. The previous key remains valid for the current rollover window only.
                      </p>
                    </div>
                    <div className="rounded-2xl border border-emerald-200 bg-white px-4 py-3 text-sm text-emerald-900 dark:border-emerald-500/30 dark:bg-slate-950 dark:text-emerald-100">
                      <div className="text-xs uppercase tracking-[0.16em] text-emerald-700 dark:text-emerald-300">
                        Previous key expires in
                      </div>
                      <div className="mt-1 text-lg font-semibold">
                        {oldKeyCountdown ?? "Calculating..."}
                      </div>
                    </div>
                  </div>
                  <div className="mt-6 grid gap-4 lg:grid-cols-2">
                    <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-950">
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                          New key
                        </div>
                        <CopyButton
                          text={rotation.newKey}
                          label="new API key"
                          className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 transition hover:border-slate-400 hover:text-slate-950 dark:border-slate-700 dark:text-slate-300 dark:hover:border-slate-500 dark:hover:text-white"
                        />
                      </div>
                      <pre className="mt-3 overflow-x-auto rounded-xl bg-slate-950 p-3 text-sm text-emerald-300">
                        <code>{rotation.newKey}</code>
                      </pre>
                    </div>
                    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-500/30 dark:bg-amber-500/10">
                      <div className="text-xs font-semibold uppercase tracking-[0.16em] text-amber-700 dark:text-amber-300">
                        Rollover status
                      </div>
                      <p className="mt-3 text-sm leading-7 text-amber-900 dark:text-amber-100">
                        Previous key: <span className="font-semibold">{obfuscateApiKey(rotation.previousKey)}</span>
                      </p>
                      <p className="mt-2 text-sm leading-7 text-amber-900 dark:text-amber-100">
                        Rotating will expire your old key in 60 minutes. Move any running integrations to the new value before the timer reaches zero.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {rotateError && (
                <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200">
                  {rotateError}
                </div>
              )}

              <div className="grid gap-6 xl:grid-cols-[1.25fr_0.95fr]">
                <div className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
                  <div className="flex items-center justify-between border-b border-slate-200 bg-slate-950 px-5 py-3 dark:border-slate-800">
                    <span className="text-xs font-medium uppercase tracking-[0.16em] text-slate-400">
                      API key management
                    </span>
                    <CopyButton
                      text={apiKey}
                      label="API key"
                      className="rounded-lg border border-slate-700 px-2.5 py-1 text-xs font-medium text-slate-300 transition hover:border-slate-500 hover:text-white"
                    />
                  </div>
                  <div className="space-y-5 p-6">
                    <div className="rounded-2xl bg-[linear-gradient(180deg,#0f172a_0%,#111827_100%)] p-5">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <div className="text-xs uppercase tracking-[0.16em] text-slate-400">
                            Active key
                          </div>
                          <pre className="mt-3 overflow-x-auto text-sm leading-7 text-emerald-300">
                            <code>{obfuscateApiKey(apiKey)}</code>
                          </pre>
                        </div>
                        <button
                          type="button"
                          onClick={() => void handleRotateKey()}
                          disabled={rotating}
                          className="inline-flex items-center justify-center rounded-xl bg-amber-400 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {rotating ? "Rotating..." : "Rotate key"}
                        </button>
                      </div>
                    </div>
                    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
                      Rotating will expire your old key in 60 minutes. Copy the new key into production before the rollover window closes.
                    </div>
                    <div className="grid gap-4 sm:grid-cols-3">
                      <div className="rounded-2xl bg-slate-50 p-4 dark:bg-slate-950">
                        <div className="text-xs uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                          Active keys
                        </div>
                        <div className="mt-2 text-2xl font-semibold text-slate-900 dark:text-white">
                          {(portal?.total_keys ?? 0).toLocaleString()}
                        </div>
                      </div>
                      <div className="rounded-2xl bg-slate-50 p-4 dark:bg-slate-950">
                        <div className="text-xs uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                          Current tier
                        </div>
                        <div className="mt-2">
                          <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${tierInfo.badgeClassName}`}>
                            {tierInfo.label}
                          </span>
                        </div>
                      </div>
                      <div className="rounded-2xl bg-slate-50 p-4 dark:bg-slate-950">
                        <div className="text-xs uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                          Reset
                        </div>
                        <div className="mt-2 text-sm font-semibold text-slate-900 dark:text-white">
                          {resetLabel}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
                        Usage stats
                      </h2>
                      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                        Current request volume and plan pressure.
                      </p>
                    </div>
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                      {usagePercent.toFixed(0)}% used
                    </span>
                  </div>
                  <div className="mt-6 grid grid-cols-2 gap-4">
                    <div className="rounded-2xl bg-slate-50 p-4 dark:bg-slate-950">
                      <div className="text-xs uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                        Requests today
                      </div>
                      <div className="mt-2 text-3xl font-bold text-slate-900 dark:text-white">
                        {requestsToday.toLocaleString()}
                      </div>
                    </div>
                    <div className="rounded-2xl bg-slate-50 p-4 dark:bg-slate-950">
                      <div className="text-xs uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                        This month
                      </div>
                      <div className="mt-2 text-3xl font-bold text-slate-900 dark:text-white">
                        {requestsThisMonth.toLocaleString()}
                      </div>
                    </div>
                    <div className="rounded-2xl bg-slate-50 p-4 dark:bg-slate-950">
                      <div className="text-xs uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                        Rate limit tier
                      </div>
                      <div className="mt-2 text-xl font-semibold text-slate-900 dark:text-white">
                        {tierInfo.label}
                      </div>
                    </div>
                    <div className="rounded-2xl bg-slate-50 p-4 dark:bg-slate-950">
                      <div className="text-xs uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                        Request rate
                      </div>
                      <div className="mt-2 text-xl font-semibold text-slate-900 dark:text-white">
                        {requestsPerMinute ? `${requestsPerMinute.toLocaleString()}/min` : `${dailyLimit.toLocaleString()}/day`}
                      </div>
                    </div>
                  </div>
                  <div className="mt-6">
                    <UsageProgressBar
                      used={requestsToday}
                      limit={dailyLimit}
                      label="Daily API usage"
                    />
                  </div>
                  <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">
                    {Math.max(dailyLimit - requestsToday, 0).toLocaleString()} requests remaining before reset.
                  </p>
                  {tier === "free" ? (
                    <div className="mt-6 rounded-2xl border border-indigo-200 bg-indigo-50 p-4 dark:border-indigo-500/30 dark:bg-indigo-500/10">
                      <div className="text-sm font-semibold text-slate-900 dark:text-white">
                        Free tier users can upgrade when daily quota becomes a blocker.
                      </div>
                      <div className="mt-3 flex flex-wrap gap-3">
                        <Link
                          href="/billing"
                          className="inline-flex items-center justify-center rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700"
                        >
                          Upgrade plan
                        </Link>
                        <Link
                          href="/pricing"
                          className="inline-flex items-center justify-center rounded-xl border border-indigo-200 bg-white px-4 py-2.5 text-sm font-semibold text-indigo-700 transition hover:bg-indigo-100 dark:border-indigo-500/30 dark:bg-slate-950 dark:text-indigo-300 dark:hover:bg-slate-900"
                        >
                          Compare pricing
                        </Link>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-6 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-500/30 dark:bg-emerald-500/10">
                      <div className="text-sm font-semibold text-slate-900 dark:text-white">
                        {tierInfo.label} is active on this account.
                      </div>
                      <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                        Visit billing if you need a larger quota window or plan changes.
                      </p>
                    </div>
                  )}
                </div>
              </div>

              <div className="grid gap-6 xl:grid-cols-[1fr_1fr]">
                <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                  <div className="mb-4">
                    <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Quick links</h2>
                    <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                      Developer resources you are likely to need during setup and debugging.
                    </p>
                  </div>
                  <div className="grid gap-3">
                    {[
                      { href: "/docs", title: "API docs", body: "Endpoint details, schemas, and auth requirements." },
                      { href: "/quickstart", title: "Quickstart", body: "Make the first authenticated request in minutes." },
                      { href: "/alerts", title: "Alerts", body: "Manage webhook subscriptions and review alert deliveries." },
                      { href: "/use-cases", title: "Use case guides", body: "Reference implementations for shopping agents and catalog apps." },
                    ].map((item) => (
                      <Link
                        key={item.href}
                        href={item.href}
                        className="rounded-2xl border border-slate-200 px-4 py-4 transition hover:border-indigo-300 hover:bg-indigo-50 dark:border-slate-800 dark:hover:border-indigo-500/40 dark:hover:bg-slate-950"
                      >
                        <div className="text-sm font-semibold text-slate-900 dark:text-white">{item.title}</div>
                        <div className="mt-1 text-sm text-slate-500 dark:text-slate-400">{item.body}</div>
                      </Link>
                    ))}
                  </div>
                  <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-xs uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                          MCP config snippet
                        </div>
                        <div className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                          Copy-ready local config for BuyWhere&apos;s MCP server.
                        </div>
                      </div>
                      <CopyButton
                        text={mcpSnippet}
                        label="MCP config"
                        className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 transition hover:border-slate-400 hover:text-slate-950 dark:border-slate-700 dark:text-slate-300 dark:hover:border-slate-500 dark:hover:text-white"
                      />
                    </div>
                    <pre className="mt-4 overflow-x-auto rounded-xl bg-slate-950 p-4 text-xs leading-6 text-emerald-300">
                      <code>{mcpSnippet}</code>
                    </pre>
                  </div>
                </div>

                <div className="space-y-6">
                  <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                    <div className="mb-4">
                      <h2 className="text-lg font-semibold text-slate-900 dark:text-white">7-day usage</h2>
                      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                        A daily view of request volume for the active key.
                      </p>
                    </div>
                    <UsageChart days={usageWindow} />
                  </div>

                  <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                    <div className="mb-4">
                      <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
                        Top queries this month
                      </h2>
                      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                        Most frequent search intents from the authenticated developer key.
                      </p>
                    </div>
                    {topQueries.length > 0 ? (
                      <div className="space-y-3">
                        {topQueries.map((entry, index) => (
                          <div
                            key={`${entry.query}-${index}`}
                            className="flex items-center justify-between gap-4 rounded-2xl border border-slate-200 px-4 py-3 dark:border-slate-800"
                          >
                            <div className="min-w-0">
                              <div className="text-xs uppercase tracking-[0.16em] text-slate-400">
                                Query #{index + 1}
                              </div>
                              <div className="truncate text-sm font-medium text-slate-900 dark:text-white">
                                {entry.query}
                              </div>
                            </div>
                            <div className="text-right">
                              <div className="text-sm font-semibold text-slate-900 dark:text-white">
                                {entry.count.toLocaleString()}
                              </div>
                              <div className="text-xs text-slate-400">requests</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-500 dark:bg-slate-950 dark:text-slate-400">
                        No query trends yet. Once the key starts serving search traffic, the highest-volume prompts will appear here.
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </div>
              )}
            </div>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
}
