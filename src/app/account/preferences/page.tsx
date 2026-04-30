"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import Footer from "@/components/Footer";
import Nav from "@/components/Nav";

interface ShopperSessionUser {
  email?: string;
}

interface UserAlert {
  id: string;
  email: string;
  product_id: number;
  product_name: string;
  product_image_url?: string | null;
  product_url?: string | null;
  price_at_add: number;
  target_price: number;
  currency: string;
  is_active: boolean;
  triggered_at?: string | null;
  created_at: string;
}

type UnsubscribeState = "idle" | "loading" | "success" | "error";

function formatCurrency(value: number, currency: string) {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency || "USD",
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${currency || "USD"} ${value.toFixed(2)}`;
  }
}

function formatTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function readShopperToken() {
  if (typeof window === "undefined") {
    return null;
  }

  return window.localStorage.getItem("bw_auth_token");
}

function readShopperUser() {
  if (typeof window === "undefined") {
    return null;
  }

  const raw = window.localStorage.getItem("bw_auth_user");
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as ShopperSessionUser;
  } catch {
    return null;
  }
}

export default function AlertPreferencesPage() {
  const searchParams = useSearchParams();
  const unsubscribeToken = searchParams?.get("token")?.trim() ?? "";

  const [shopperToken, setShopperToken] = useState<string | null>(null);
  const [shopperUser, setShopperUser] = useState<ShopperSessionUser | null>(null);
  const [alerts, setAlerts] = useState<UserAlert[]>([]);
  const [alertsLoading, setAlertsLoading] = useState(false);
  const [alertsError, setAlertsError] = useState<string | null>(null);
  const [unsubscribeState, setUnsubscribeState] = useState<UnsubscribeState>(unsubscribeToken ? "loading" : "idle");
  const [unsubscribeMessage, setUnsubscribeMessage] = useState<string | null>(null);
  const [busyAlertId, setBusyAlertId] = useState<string | null>(null);

  useEffect(() => {
    setShopperToken(readShopperToken());
    setShopperUser(readShopperUser());
  }, []);

  useEffect(() => {
    if (!unsubscribeToken) {
      return;
    }

    let cancelled = false;

    async function unsubscribe() {
      setUnsubscribeState("loading");
      setUnsubscribeMessage(null);

      try {
        const response = await fetch(`/api/alerts/unsubscribe?token=${encodeURIComponent(unsubscribeToken)}`, {
          cache: "no-store",
        });
        const payload = await response.json().catch(() => null);

        if (!response.ok) {
          throw new Error(payload?.detail ?? payload?.error ?? payload?.message ?? "Unable to unsubscribe this alert.");
        }

        if (cancelled) {
          return;
        }

        setUnsubscribeState("success");
        setUnsubscribeMessage(
          payload?.message ??
            "This price alert has been unsubscribed. You will not receive future emails for it."
        );
      } catch (error) {
        if (cancelled) {
          return;
        }

        setUnsubscribeState("error");
        setUnsubscribeMessage(
          error instanceof Error ? error.message : "Unable to unsubscribe this alert."
        );
      }
    }

    void unsubscribe();

    return () => {
      cancelled = true;
    };
  }, [unsubscribeToken]);

  useEffect(() => {
    if (!shopperToken) {
      return;
    }

    let cancelled = false;

    async function loadAlerts() {
      setAlertsLoading(true);
      setAlertsError(null);

      try {
        const response = await fetch("/api/auth/me/alerts", {
          headers: {
            Authorization: `Bearer ${shopperToken}`,
          },
          cache: "no-store",
        });
        const payload = await response.json().catch(() => null);

        if (!response.ok) {
          throw new Error(payload?.detail ?? payload?.error ?? "Failed to load your alerts.");
        }

        if (cancelled) {
          return;
        }

        setAlerts(Array.isArray(payload?.alerts) ? payload.alerts as UserAlert[] : []);
      } catch (error) {
        if (cancelled) {
          return;
        }

        setAlertsError(error instanceof Error ? error.message : "Failed to load your alerts.");
      } finally {
        if (!cancelled) {
          setAlertsLoading(false);
        }
      }
    }

    void loadAlerts();

    return () => {
      cancelled = true;
    };
  }, [shopperToken]);

  async function deleteAlert(alertId: string) {
    if (!shopperToken) {
      return;
    }

    setBusyAlertId(alertId);
    setAlertsError(null);

    try {
      const response = await fetch(`/api/auth/me/alerts/${encodeURIComponent(alertId)}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${shopperToken}`,
        },
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.detail ?? payload?.error ?? "Failed to delete alert.");
      }

      setAlerts((current) => current.filter((alert) => alert.id !== alertId));
    } catch (error) {
      setAlertsError(error instanceof Error ? error.message : "Failed to delete alert.");
    } finally {
      setBusyAlertId(null);
    }
  }

  async function toggleAlert(alert: UserAlert) {
    if (!shopperToken) {
      return;
    }

    setBusyAlertId(alert.id);
    setAlertsError(null);

    try {
      const response = await fetch(`/api/auth/me/alerts/${encodeURIComponent(alert.id)}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${shopperToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ is_active: !alert.is_active }),
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(
          payload?.detail ??
            payload?.error ??
            "Pause and resume will work as soon as the alert preference API is available."
        );
      }

      setAlerts((current) =>
        current.map((item) =>
          item.id === alert.id
            ? {
                ...item,
                is_active: typeof payload?.is_active === "boolean" ? payload.is_active : !alert.is_active,
              }
            : item
        )
      );
    } catch (error) {
      setAlertsError(
        error instanceof Error
          ? error.message
          : "Pause and resume will work as soon as the alert preference API is available."
      );
    } finally {
      setBusyAlertId(null);
    }
  }

  const activeAlerts = alerts.filter((alert) => alert.is_active);

  return (
    <div className="flex min-h-screen flex-col bg-white text-slate-950">
      <Nav />

      <main className="flex-1 bg-[radial-gradient(circle_at_top_left,_rgba(37,99,235,0.12),_transparent_34%),linear-gradient(180deg,#f8fafc_0%,#ffffff_40%,#eef2ff_100%)]">
        <section className="border-b border-slate-200 bg-slate-950 text-white">
          <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
            <div className="max-w-3xl">
              <div className="inline-flex items-center rounded-full border border-white/10 bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-indigo-100">
                Email preferences
              </div>
              <h1 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">
                Control which price alerts reach your inbox.
              </h1>
              <p className="mt-3 text-sm leading-7 text-slate-300 sm:text-base">
                Unsubscribe from a single alert in one click, or manage every active price watch from one place when you have a shopper session on this device.
              </p>
            </div>
          </div>
        </section>

        <section className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6">
          {unsubscribeToken && (
            <div
              className={`rounded-[28px] border px-6 py-6 shadow-sm ${
                unsubscribeState === "success"
                  ? "border-emerald-200 bg-emerald-50"
                  : unsubscribeState === "error"
                    ? "border-red-200 bg-red-50"
                    : "border-slate-200 bg-white"
              }`}
              aria-live="polite"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                    One-click unsubscribe
                  </div>
                  <h2 className="mt-2 text-xl font-semibold text-slate-950">
                    {unsubscribeState === "loading"
                      ? "Removing this alert from your email notifications..."
                      : unsubscribeState === "success"
                        ? "This alert is unsubscribed."
                        : "We could not complete this unsubscribe request."}
                  </h2>
                  {unsubscribeMessage && (
                    <p className="mt-2 max-w-2xl text-sm leading-7 text-slate-700">
                      {unsubscribeMessage}
                    </p>
                  )}
                </div>

                {unsubscribeState === "success" && (
                  <span className="inline-flex self-start rounded-full bg-emerald-600 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-white">
                    Updated
                  </span>
                )}
              </div>
            </div>
          )}

          <div className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
            <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                    Preference center
                  </div>
                  <h2 className="mt-2 text-2xl font-semibold text-slate-950">
                    Active alerts
                  </h2>
                  <p className="mt-2 text-sm leading-7 text-slate-600">
                    {shopperUser?.email
                      ? `Signed in as ${shopperUser.email}.`
                      : "This panel loads when a shopper session is already present in your browser."}
                  </p>
                </div>
                <div className="rounded-2xl bg-slate-950 px-4 py-3 text-white">
                  <div className="text-xs uppercase tracking-[0.16em] text-slate-300">Active</div>
                  <div className="mt-1 text-2xl font-semibold">{activeAlerts.length}</div>
                </div>
              </div>

              {alertsError && (
                <div className="mt-6 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {alertsError}
                </div>
              )}

              {!shopperToken ? (
                <div className="mt-6 rounded-3xl border border-dashed border-slate-300 bg-slate-50 p-6">
                  <h3 className="text-lg font-semibold text-slate-950">No shopper session found</h3>
                  <p className="mt-2 text-sm leading-7 text-slate-600">
                    Open this page from a device where you are signed into BuyWhere to manage every alert at once. Unsubscribe links from alert emails still work without signing in.
                  </p>
                </div>
              ) : alertsLoading ? (
                <div className="mt-6 text-sm text-slate-500">Loading your alerts...</div>
              ) : alerts.length === 0 ? (
                <div className="mt-6 rounded-3xl border border-dashed border-slate-300 bg-slate-50 p-6">
                  <h3 className="text-lg font-semibold text-slate-950">No active alerts on this account</h3>
                  <p className="mt-2 text-sm leading-7 text-slate-600">
                    Create a price alert from any product page and it will appear here.
                  </p>
                </div>
              ) : (
                <div className="mt-6 space-y-4">
                  {alerts.map((alert) => {
                    const isBusy = busyAlertId === alert.id;

                    return (
                      <article
                        key={alert.id}
                        className="rounded-3xl border border-slate-200 bg-slate-50 p-4"
                      >
                        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                          <div className="flex min-w-0 gap-4">
                            {alert.product_image_url ? (
                              <Image
                                src={alert.product_image_url}
                                alt=""
                                width={80}
                                height={80}
                                className="h-20 w-20 rounded-2xl border border-slate-200 object-cover"
                              />
                            ) : (
                              <div className="flex h-20 w-20 items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
                                Alert
                              </div>
                            )}

                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <h3 className="text-base font-semibold text-slate-950">
                                  {alert.product_name}
                                </h3>
                                <span
                                  className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${
                                    alert.is_active
                                      ? "bg-emerald-100 text-emerald-800"
                                      : "bg-slate-200 text-slate-700"
                                  }`}
                                >
                                  {alert.is_active ? "Active" : "Paused"}
                                </span>
                              </div>

                              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2 text-sm text-slate-600">
                                <span>Target: {formatCurrency(alert.target_price, alert.currency)}</span>
                                <span>Started at: {formatCurrency(alert.price_at_add, alert.currency)}</span>
                                <span>Created: {formatTimestamp(alert.created_at)}</span>
                              </div>

                              {alert.product_url && (
                                <Link
                                  href={alert.product_url}
                                  className="mt-3 inline-flex text-sm font-medium text-indigo-700 hover:text-indigo-600"
                                >
                                  View product
                                </Link>
                              )}
                            </div>
                          </div>

                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => void toggleAlert(alert)}
                              disabled={isBusy}
                              className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              {isBusy ? "Saving..." : alert.is_active ? "Pause" : "Resume"}
                            </button>
                            <button
                              type="button"
                              onClick={() => void deleteAlert(alert.id)}
                              disabled={isBusy}
                              className="rounded-xl border border-red-200 bg-white px-4 py-2 text-sm font-semibold text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="space-y-6">
              <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
                <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                  Email behavior
                </div>
                <h2 className="mt-2 text-2xl font-semibold text-slate-950">
                  What changes here
                </h2>
                <div className="mt-4 space-y-4 text-sm leading-7 text-slate-600">
                  <p>
                    `Pause` keeps the alert configured but stops sends until you resume it.
                  </p>
                  <p>
                    `Delete` removes the alert entirely, including its price target and product association.
                  </p>
                  <p>
                    Email unsubscribe links act on a single alert, so you can stop one product without affecting the rest of your watch list.
                  </p>
                </div>
              </div>

              <div className="rounded-[28px] border border-indigo-200 bg-[linear-gradient(135deg,rgba(238,242,255,0.96),rgba(224,231,255,0.88))] p-6 shadow-sm">
                <div className="text-xs font-semibold uppercase tracking-[0.16em] text-indigo-700">
                  Built for email handoff
                </div>
                <h2 className="mt-2 text-2xl font-semibold text-slate-950">
                  The page works best as the destination from alert emails.
                </h2>
                <p className="mt-3 text-sm leading-7 text-slate-700">
                  The one-click path requires only the signed unsubscribe token. When a shopper is also signed in on the same device, the full preference center can load the rest of their alerts immediately.
                </p>
              </div>
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
