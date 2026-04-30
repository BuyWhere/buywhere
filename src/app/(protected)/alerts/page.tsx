"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import DashboardSidebar from "@/components/dashboard/DashboardSidebar";

type UiEventType = "price_change" | "restock" | "new_product";

interface WebhookRow {
  id: string;
  url: string;
  events: string[];
  productIds: number[];
  active: boolean;
  createdAt: string;
  lastTriggeredAt: string | null;
  lastDeliveryStatus: string | null;
}

interface HistoryRow {
  id: string;
  timestamp: string;
  productId: number;
  product: string;
  eventType: string;
  webhookUrl: string;
  status: string;
}

interface WebhookMetaRecord {
  uiEvents: UiEventType[];
}

const EVENT_OPTIONS: Array<{
  id: UiEventType;
  label: string;
  description: string;
  backendEvents: string[];
}> = [
  {
    id: "price_change",
    label: "Price change",
    description: "Fire when BuyWhere detects a relevant price move.",
    backendEvents: ["price.updated", "price.dropped"],
  },
  {
    id: "restock",
    label: "Restock",
    description: "Show as a restock subscription in the dashboard.",
    backendEvents: ["metrics.alert"],
  },
  {
    id: "new_product",
    label: "New product",
    description: "Track newly indexed products in the same feed.",
    backendEvents: ["metrics.alert"],
  },
];

const LOCAL_META_KEY = "bw_dashboard_alert_webhook_meta";

function readWebhookMeta() {
  if (typeof window === "undefined") {
    return {} as Record<string, WebhookMetaRecord>;
  }

  try {
    const parsed = JSON.parse(window.localStorage.getItem(LOCAL_META_KEY) ?? "{}");
    return parsed && typeof parsed === "object" ? parsed as Record<string, WebhookMetaRecord> : {};
  } catch {
    return {};
  }
}

function writeWebhookMeta(nextValue: Record<string, WebhookMetaRecord>) {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(LOCAL_META_KEY, JSON.stringify(nextValue));
  }
}

function truncateUrl(value: string) {
  if (value.length <= 48) {
    return value;
  }

  return `${value.slice(0, 30)}...${value.slice(-14)}`;
}

function formatTimestamp(value: string | null) {
  if (!value) {
    return "No deliveries yet";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function prettifyEventLabel(value: string) {
  return value.replaceAll("_", " ");
}

function inferUiEvents(webhook: WebhookRow, localMeta: Record<string, WebhookMetaRecord>) {
  const fromLocal = localMeta[webhook.id]?.uiEvents;
  if (Array.isArray(fromLocal) && fromLocal.length > 0) {
    return fromLocal;
  }

  const inferred = new Set<UiEventType>();
  if (webhook.events.includes("price.updated") || webhook.events.includes("price.dropped")) {
    inferred.add("price_change");
  }
  if (webhook.events.includes("metrics.alert")) {
    inferred.add("restock");
  }

  return Array.from(inferred);
}

export default function AlertsPage() {
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [sendingTest, setSendingTest] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [webhooks, setWebhooks] = useState<WebhookRow[]>([]);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [selectedWebhookId, setSelectedWebhookId] = useState("");
  const [testProductId, setTestProductId] = useState("");
  const [formUrl, setFormUrl] = useState("");
  const [formProductIds, setFormProductIds] = useState("");
  const [selectedEvents, setSelectedEvents] = useState<UiEventType[]>(["price_change"]);

  const loadAlerts = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/dashboard/alerts", { cache: "no-store" });
      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(payload?.error ?? "Failed to load alert subscriptions");
      }

      const localMeta = readWebhookMeta();
      const nextWebhooks = Array.isArray(payload?.webhooks) ? payload.webhooks as WebhookRow[] : [];
      const nextHistory = Array.isArray(payload?.history) ? payload.history as HistoryRow[] : [];

      setWebhooks(nextWebhooks);
      setHistory(nextHistory);

      if (nextWebhooks.length > 0) {
        setSelectedWebhookId((current) => current || nextWebhooks[0].id);
        setTestProductId((current) => current || String(nextWebhooks[0].productIds[0] ?? ""));
      }

      const normalizedMeta = { ...localMeta };
      for (const webhook of nextWebhooks) {
        if (!normalizedMeta[webhook.id]) {
          normalizedMeta[webhook.id] = {
            uiEvents: inferUiEvents(webhook, localMeta),
          };
        }
      }
      writeWebhookMeta(normalizedMeta);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load alert subscriptions");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAlerts();
  }, [loadAlerts]);

  async function handleCreateWebhook(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setSuccessMessage(null);

    const productIds = formProductIds
      .split(",")
      .map((value) => Number(value.trim()))
      .filter((value) => Number.isFinite(value) && value > 0);

    if (productIds.length === 0) {
      setSubmitting(false);
      setError("Add at least one product ID. The current alert pipeline is product-scoped.");
      return;
    }

    if (selectedEvents.length === 0) {
      setSubmitting(false);
      setError("Select at least one event type.");
      return;
    }

    const backendEvents = Array.from(
      new Set(
        EVENT_OPTIONS
          .filter((option) => selectedEvents.includes(option.id))
          .flatMap((option) => option.backendEvents)
      )
    );

    try {
      const response = await fetch("/api/dashboard/alerts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          url: formUrl,
          product_ids: productIds,
          event_types: backendEvents,
          threshold_percent: 5,
        }),
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.detail ?? payload?.error ?? "Failed to add webhook");
      }

      const nextMeta = readWebhookMeta();
      nextMeta[payload.id] = { uiEvents: selectedEvents };
      writeWebhookMeta(nextMeta);

      setShowModal(false);
      setFormUrl("");
      setFormProductIds("");
      setSelectedEvents(["price_change"]);
      setSuccessMessage("Webhook added.");
      await loadAlerts();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add webhook");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleToggleWebhook(webhook: WebhookRow) {
    setError(null);
    setSuccessMessage(null);

    try {
      const response = await fetch(`/api/dashboard/alerts/${encodeURIComponent(webhook.id)}/active`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ active: !webhook.active }),
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.detail ?? payload?.error ?? "Failed to update webhook");
      }

      setSuccessMessage(webhook.active ? "Webhook paused." : "Webhook activated.");
      await loadAlerts();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update webhook");
    }
  }

  async function handleDeleteWebhook(webhookId: string) {
    setError(null);
    setSuccessMessage(null);

    try {
      const response = await fetch(`/api/dashboard/alerts/${encodeURIComponent(webhookId)}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.detail ?? payload?.error ?? "Failed to delete webhook");
      }

      const nextMeta = readWebhookMeta();
      delete nextMeta[webhookId];
      writeWebhookMeta(nextMeta);

      setSuccessMessage("Webhook deleted.");
      await loadAlerts();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete webhook");
    }
  }

  async function handleSendTest() {
    if (!selectedWebhookId) {
      setError("Select a webhook before sending a test.");
      return;
    }

    setSendingTest(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const response = await fetch("/api/v1/test/price-alert", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          webhookId: selectedWebhookId,
          productId: Number(testProductId),
        }),
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.detail ?? payload?.error ?? "Failed to send test webhook");
      }

      setSuccessMessage(payload?.message ?? "Test webhook sent.");
      await loadAlerts();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send test webhook");
    } finally {
      setSendingTest(false);
    }
  }

  const localMeta = readWebhookMeta();
  const activeCount = webhooks.filter((webhook) => webhook.active).length;
  const selectedWebhook = webhooks.find((webhook) => webhook.id === selectedWebhookId) ?? null;

  return (
    <div className="flex min-h-screen flex-col bg-white text-slate-950 dark:bg-slate-950 dark:text-slate-50">
      <Nav />

      <section className="border-b border-slate-200 bg-[radial-gradient(circle_at_top_left,_rgba(255,255,255,0.2),_transparent_34%),linear-gradient(140deg,#0f172a_0%,#1d4ed8_58%,#0b1120_100%)] py-14 text-white dark:border-slate-800">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 sm:px-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-indigo-100">
              Price alerts
            </div>
            <h1 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">
              Manage webhook subscriptions for price alert delivery.
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-indigo-100 sm:text-base">
              Keep active destinations clean, verify endpoints before launch, and inspect the most recent alert traffic without leaving the dashboard.
            </p>
          </div>
          <div className="grid gap-3 self-start sm:grid-cols-2 lg:min-w-[320px]">
            <div className="rounded-2xl border border-white/15 bg-white/10 px-5 py-4 backdrop-blur">
              <div className="text-xs uppercase tracking-[0.16em] text-indigo-100/80">Active webhooks</div>
              <div className="mt-2 text-3xl font-bold text-white">{activeCount}</div>
            </div>
            <div className="rounded-2xl border border-white/15 bg-slate-950/20 px-5 py-4 backdrop-blur">
              <div className="text-xs uppercase tracking-[0.16em] text-indigo-100/80">Recent alerts</div>
              <div className="mt-2 text-3xl font-bold text-white">{history.length}</div>
            </div>
          </div>
        </div>
      </section>

      <section className="flex-1 bg-slate-50 py-10 dark:bg-slate-950">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="space-y-6 xl:grid xl:grid-cols-[240px_minmax(0,1fr)] xl:items-start xl:gap-6 xl:space-y-0">
            <DashboardSidebar />

            <div className="space-y-6">
              {(error || successMessage) && (
                <div
                  className={`rounded-2xl border px-5 py-4 text-sm shadow-sm ${
                    error
                      ? "border-red-200 bg-red-50 text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200"
                      : "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200"
                  }`}
                >
                  {error ?? successMessage}
                </div>
              )}

              <div className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
                <div className="flex flex-col gap-4 border-b border-slate-200 px-6 py-5 dark:border-slate-800 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Active webhooks</h2>
                    <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                      Registered destinations, subscribed event types, and latest delivery state.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowModal(true)}
                    className="inline-flex items-center justify-center rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700"
                  >
                    Add webhook
                  </button>
                </div>

                {loading ? (
                  <div className="px-6 py-14 text-sm text-slate-500 dark:text-slate-400">
                    Loading alert subscriptions...
                  </div>
                ) : webhooks.length === 0 ? (
                  <div className="px-6 py-14">
                    <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center dark:border-slate-700 dark:bg-slate-950">
                      <h3 className="text-lg font-semibold text-slate-900 dark:text-white">No price alerts yet</h3>
                      <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                        Find a product and set your target price.
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-slate-200 dark:divide-slate-800">
                      <thead className="bg-slate-50 dark:bg-slate-950">
                        <tr className="text-left text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                          <th className="px-6 py-4">Webhook URL</th>
                          <th className="px-6 py-4">Events</th>
                          <th className="px-6 py-4">Last triggered</th>
                          <th className="px-6 py-4">Status</th>
                          <th className="px-6 py-4 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                        {webhooks.map((webhook) => {
                          const uiEvents = inferUiEvents(webhook, localMeta);

                          return (
                            <tr key={webhook.id} className="align-top">
                              <td className="px-6 py-5">
                                <div className="max-w-[320px]">
                                  <div className="truncate text-sm font-semibold text-slate-900 dark:text-white" title={webhook.url}>
                                    {truncateUrl(webhook.url)}
                                  </div>
                                  <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                                    Product IDs: {webhook.productIds.length > 0 ? webhook.productIds.join(", ") : "None"}
                                  </div>
                                </div>
                              </td>
                              <td className="px-6 py-5">
                                <div className="flex max-w-[220px] flex-wrap gap-2">
                                  {(uiEvents.length > 0 ? uiEvents : ["price_change"]).map((eventName) => (
                                    <span
                                      key={eventName}
                                      className="inline-flex rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-200"
                                    >
                                      {prettifyEventLabel(eventName)}
                                    </span>
                                  ))}
                                </div>
                              </td>
                              <td className="px-6 py-5 text-sm text-slate-600 dark:text-slate-300">
                                {formatTimestamp(webhook.lastTriggeredAt)}
                              </td>
                              <td className="px-6 py-5">
                                <span
                                  className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${
                                    webhook.active
                                      ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-200"
                                      : "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-200"
                                  }`}
                                >
                                  {webhook.active ? "Active" : "Paused"}
                                </span>
                                {webhook.lastDeliveryStatus && (
                                  <div className="mt-2 text-xs text-slate-400">
                                    Last delivery: {webhook.lastDeliveryStatus.replaceAll("_", " ")}
                                  </div>
                                )}
                              </td>
                              <td className="px-6 py-5">
                                <div className="flex justify-end gap-2">
                                  <button
                                    type="button"
                                    onClick={() => void handleToggleWebhook(webhook)}
                                    className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-950"
                                  >
                                    {webhook.active ? "Pause" : "Resume"}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => void handleDeleteWebhook(webhook.id)}
                                    className="rounded-lg border border-red-200 px-3 py-2 text-xs font-medium text-red-700 transition hover:bg-red-50 dark:border-red-500/30 dark:text-red-200 dark:hover:bg-red-500/10"
                                  >
                                    Delete
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div className="grid gap-6 lg:grid-cols-[0.95fr_1.05fr]">
                <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Test webhook</h2>
                      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                        Send a verification event before wiring the subscription into production flows.
                      </p>
                    </div>
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                      POST /api/v1/test/price-alert
                    </span>
                  </div>

                  <div className="mt-6 space-y-4">
                    <div>
                      <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-200">
                        Registered webhook
                      </label>
                      <select
                        value={selectedWebhookId}
                        onChange={(event) => {
                          const nextId = event.target.value;
                          setSelectedWebhookId(nextId);
                          const nextWebhook = webhooks.find((webhook) => webhook.id === nextId);
                          if (nextWebhook?.productIds[0]) {
                            setTestProductId(String(nextWebhook.productIds[0]));
                          }
                        }}
                        className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none ring-0 transition focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                      >
                        <option value="">Select a webhook</option>
                        {webhooks.map((webhook) => (
                          <option key={webhook.id} value={webhook.id}>
                            {truncateUrl(webhook.url)}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-200">
                        Product ID to simulate
                      </label>
                      <input
                        type="number"
                        min="1"
                        value={testProductId}
                        onChange={(event) => setTestProductId(event.target.value)}
                        placeholder="e.g. 12345"
                        className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                      />
                    </div>

                    <button
                      type="button"
                      onClick={() => void handleSendTest()}
                      disabled={sendingTest || !selectedWebhookId}
                      className="inline-flex items-center justify-center rounded-xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200"
                    >
                      {sendingTest ? "Sending..." : "Send test"}
                    </button>
                  </div>

                  {selectedWebhook && (
                    <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300">
                      The selected endpoint currently monitors product IDs {selectedWebhook.productIds.join(", ") || "none"}.
                    </div>
                  )}
                </div>

                <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Alert history</h2>
                      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                        Last 20 delivered alerts across the authenticated developer account.
                      </p>
                    </div>
                    <Link
                      href="/docs"
                      className="text-sm font-medium text-indigo-600 transition hover:text-indigo-500 dark:text-indigo-300"
                    >
                      Review payload docs
                    </Link>
                  </div>

                  {history.length === 0 ? (
                    <div className="mt-6 rounded-3xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-400">
                      Delivered alerts will appear here after the first successful trigger.
                    </div>
                  ) : (
                    <div className="mt-6 overflow-x-auto">
                      <table className="min-w-full divide-y divide-slate-200 dark:divide-slate-800">
                        <thead>
                          <tr className="text-left text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                            <th className="pb-3 pr-4">Timestamp</th>
                            <th className="pb-3 pr-4">Product</th>
                            <th className="pb-3 pr-4">Event type</th>
                            <th className="pb-3 pr-4">Webhook URL</th>
                            <th className="pb-3">Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                          {history.map((entry) => (
                            <tr key={`${entry.id}-${entry.timestamp}`} className="align-top">
                              <td className="py-4 pr-4 text-sm text-slate-600 dark:text-slate-300">
                                {formatTimestamp(entry.timestamp)}
                              </td>
                              <td className="py-4 pr-4">
                                <div className="text-sm font-medium text-slate-900 dark:text-white">{entry.product}</div>
                                <div className="mt-1 text-xs text-slate-400">Product #{entry.productId}</div>
                              </td>
                              <td className="py-4 pr-4 text-sm text-slate-600 dark:text-slate-300">
                                {prettifyEventLabel(entry.eventType)}
                              </td>
                              <td className="py-4 pr-4 text-sm text-slate-600 dark:text-slate-300" title={entry.webhookUrl}>
                                {truncateUrl(entry.webhookUrl)}
                              </td>
                              <td className="py-4">
                                <span className="inline-flex rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-200">
                                  {entry.status}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>

              <div className="rounded-[28px] border border-indigo-200 bg-[linear-gradient(135deg,rgba(238,242,255,0.95),rgba(224,231,255,0.9))] p-6 shadow-sm dark:border-indigo-500/30 dark:bg-[linear-gradient(135deg,rgba(30,41,59,0.96),rgba(15,23,42,0.98))]">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                  <div className="max-w-2xl">
                    <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Implementation note</h2>
                    <p className="mt-2 text-sm leading-7 text-slate-700 dark:text-slate-300">
                      The current backend requires product-scoped subscriptions. This page keeps the requested webhook UX, while exposing product IDs in the add flow so developers can register subscriptions against the live pipeline today.
                    </p>
                  </div>
                  <Link
                    href="/quickstart"
                    className="inline-flex items-center justify-center rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200"
                  >
                    Open quickstart
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <Footer />

      {showModal && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/60 px-4 py-8 backdrop-blur-sm">
          <div className="w-full max-w-2xl rounded-[28px] border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-5 dark:border-slate-800">
              <div>
                <h2 className="text-xl font-semibold text-slate-900 dark:text-white">Add webhook</h2>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                  Register a destination URL and the alert signals it should receive.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                aria-label="Close add webhook modal"
              >
                <svg className="h-5 w-5" viewBox="0 0 20 20" fill="none">
                  <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </button>
            </div>

            <form onSubmit={handleCreateWebhook} className="space-y-6 px-6 py-6">
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-200">
                  Webhook URL
                </label>
                <input
                  type="url"
                  value={formUrl}
                  onChange={(event) => setFormUrl(event.target.value)}
                  placeholder="https://your-app.example.com/buywhere/alerts"
                  required
                  className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-200">
                  Events
                </label>
                <div className="grid gap-3 sm:grid-cols-3">
                  {EVENT_OPTIONS.map((option) => {
                    const checked = selectedEvents.includes(option.id);

                    return (
                      <label
                        key={option.id}
                        className={`cursor-pointer rounded-2xl border p-4 transition ${
                          checked
                            ? "border-indigo-300 bg-indigo-50 dark:border-indigo-500/40 dark:bg-indigo-500/10"
                            : "border-slate-200 bg-white hover:border-slate-300 dark:border-slate-700 dark:bg-slate-950"
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => {
                              setSelectedEvents((current) =>
                                checked
                                  ? current.filter((value) => value !== option.id)
                                  : [...current, option.id]
                              );
                            }}
                            className="mt-1 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                          />
                          <div>
                            <div className="text-sm font-semibold text-slate-900 dark:text-white">{option.label}</div>
                            <div className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">
                              {option.description}
                            </div>
                          </div>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-200">
                  Product IDs
                </label>
                <input
                  type="text"
                  value={formProductIds}
                  onChange={(event) => setFormProductIds(event.target.value)}
                  placeholder="12345, 67890"
                  className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                />
                <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                  Current backend registration is product-scoped. Separate multiple IDs with commas.
                </p>
              </div>

              <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="inline-flex items-center justify-center rounded-xl border border-slate-300 px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-950"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="inline-flex items-center justify-center rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {submitting ? "Saving..." : "Create webhook"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
