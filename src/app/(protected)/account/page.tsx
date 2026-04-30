"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import DashboardSidebar from "@/components/dashboard/DashboardSidebar";
import {
  BILLING_TIER_UI,
  canonicalizeBillingTier,
} from "@/lib/billing";

interface DeveloperProfile {
  id: string;
  email: string;
  plan: string;
  created_at: string;
}

type EmailAlertFrequency = "instant" | "daily" | "off";

interface NotificationPreferences {
  email_alert_frequency: EmailAlertFrequency;
  deal_digest: boolean;
}

interface AccountData {
  developer: DeveloperProfile;
  notification_preferences: NotificationPreferences;
}

function formatMemberSince(dateString: string) {
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) {
    return "Unknown";
  }
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

interface RadioOption<T extends string> {
  value: T;
  label: string;
  description: string;
}

interface RadioGroupProps<T extends string> {
  name: string;
  options: RadioOption<T>[];
  value: T;
  onChange: (value: T) => void;
}

function RadioGroup<T extends string>({ name, options, value, onChange }: RadioGroupProps<T>) {
  return (
    <div className="flex flex-col gap-2" role="radiogroup" aria-label={name}>
      {options.map((option) => (
        <label
          key={option.value}
          className={`flex items-start gap-3 rounded-xl border px-4 py-3 cursor-pointer transition-colors ${
            value === option.value
              ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-500/10"
              : "border-slate-200 hover:border-slate-300 dark:border-slate-700 dark:hover:border-slate-600"
          }`}
        >
          <input
            type="radio"
            name={name}
            value={option.value}
            checked={value === option.value}
            onChange={() => onChange(option.value)}
            className="mt-0.5 h-4 w-4 accent-indigo-600"
          />
          <div>
            <div className="text-sm font-medium text-slate-900 dark:text-white">
              {option.label}
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400">
              {option.description}
            </div>
          </div>
        </label>
      ))}
    </div>
  );
}

export default function AccountPage() {
  const [apiKey, setApiKey] = useState("");
  const [account, setAccount] = useState<AccountData | null>(null);
  const [preferences, setPreferences] = useState<NotificationPreferences | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const [passwordForm, setPasswordForm] = useState({ currentPassword: "", newPassword: "", confirmPassword: "" });
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSuccess, setPasswordSuccess] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);

  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const emailAlertOptions: RadioOption<EmailAlertFrequency>[] = [
    { value: "instant", label: "Instant alerts", description: "Receive notifications immediately when alerts trigger" },
    { value: "daily", label: "Daily digest", description: "Get a daily summary of all alerts" },
    { value: "off", label: "Off", description: "Disable email notifications for alerts" },
  ];

  async function loadAccount(key: string) {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/dashboard/account", {
        headers: { "x-api-key": key },
      });

      if (!response.ok) {
        throw new Error("Failed to load account information");
      }

      const payload = await response.json() as AccountData;
      setAccount(payload);
      setPreferences(payload.notification_preferences);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load account");
    } finally {
      setLoading(false);
    }
  }

  async function handleSavePreferences() {
    if (!apiKey || !preferences) {
      return;
    }

    setSaving(true);
    setSaveSuccess(false);

    try {
      const response = await fetch("/api/dashboard/account/preferences", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
        },
        body: JSON.stringify(preferences),
      });

      if (!response.ok) {
        throw new Error("Failed to save preferences");
      }

      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save preferences");
    } finally {
      setSaving(false);
    }
  }

  async function handleChangePassword() {
    if (!apiKey) {
      return;
    }

    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      setPasswordError("New passwords do not match");
      return;
    }

    if (passwordForm.newPassword.length < 8) {
      setPasswordError("New password must be at least 8 characters");
      return;
    }

    setChangingPassword(true);
    setPasswordError(null);
    setPasswordSuccess(false);

    try {
      const response = await fetch("/api/v1/auth/change-password", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
        },
        body: JSON.stringify({
          current_password: passwordForm.currentPassword,
          new_password: passwordForm.newPassword,
        }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error ?? "Failed to change password");
      }

      setPasswordSuccess(true);
      setPasswordForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
    } catch (err) {
      setPasswordError(err instanceof Error ? err.message : "Failed to change password");
    } finally {
      setChangingPassword(false);
    }
  }

  async function handleDeleteAccount() {
    if (!apiKey || deleteConfirmText !== "DELETE") {
      return;
    }

    setDeleting(true);
    setDeleteError(null);

    try {
      const response = await fetch("/api/v1/auth/delete-account", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
        },
      });

      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error ?? "Failed to delete account");
      }

      localStorage.removeItem("bw_api_key");
      window.location.href = "/";
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Failed to delete account");
    } finally {
      setDeleting(false);
    }
  }

  function updatePreference(key: keyof NotificationPreferences, value: EmailAlertFrequency | boolean) {
    if (!preferences) return;
    setPreferences({ ...preferences, [key]: value });
  }

  useEffect(() => {
    const stored = localStorage.getItem("bw_api_key");

    if (stored) {
      setApiKey(stored);
      void loadAccount(stored);
    }
  }, []);

  const tier = canonicalizeBillingTier(account?.developer?.plan);
  const tierInfo = BILLING_TIER_UI[tier] ?? BILLING_TIER_UI.free;

  return (
    <div className="flex min-h-screen flex-col bg-white text-slate-950 dark:bg-slate-950 dark:text-slate-50">
      <Nav />

      <section className="border-b border-slate-200 bg-[radial-gradient(circle_at_top_left,_rgba(255,255,255,0.18),_transparent_34%),linear-gradient(135deg,#312e81_0%,#1d4ed8_58%,#0f172a_100%)] py-14 text-white dark:border-slate-800">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-indigo-100">
                Account settings
              </div>
              <h1 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">
                Manage your account preferences.
              </h1>
              <p className="mt-3 max-w-2xl text-sm leading-7 text-indigo-100 sm:text-base">
                Update your profile information, notification preferences, and security settings.
              </p>
            </div>
            {account && (
              <div className="flex items-center gap-3 self-start lg:self-auto">
                <div className="rounded-2xl border border-white/15 bg-white/10 px-5 py-4 backdrop-blur">
                  <div className="text-xs uppercase tracking-[0.16em] text-indigo-100/80">
                    Signed in as
                  </div>
                  <div className="mt-2 text-sm font-semibold text-white">
                    {account.developer.email}
                  </div>
                  <div className="mt-2 inline-flex items-center rounded-full bg-white/15 px-3 py-1 text-xs font-medium text-white">
                    {tierInfo.label} tier
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
                    Sign in with an existing key to manage your account settings.
                  </p>
                  <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                    <Link
                      href="/login?next=%2Faccount"
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
                    Loading account...
                  </div>
                </div>
              ) : error ? (
                <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center dark:border-red-500/30 dark:bg-red-500/10">
                  <p className="mb-2 font-medium text-red-700 dark:text-red-300">Failed to load account</p>
                  <p className="text-sm text-red-600 dark:text-red-200">{error}</p>
                  <button
                    type="button"
                    onClick={() => loadAccount(apiKey)}
                    className="mt-4 text-sm text-indigo-600 hover:underline dark:text-indigo-300"
                  >
                    Try again
                  </button>
                </div>
              ) : account && preferences ? (
                <div className="space-y-6">
                  <div className="rounded-[28px] border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
                    <div className="flex items-center justify-between border-b border-slate-200 bg-slate-950 px-5 py-3 dark:border-slate-800">
                      <span className="text-xs font-medium uppercase tracking-[0.16em] text-slate-400">
                        Profile
                      </span>
                    </div>
                    <div className="space-y-6 p-6">
                      <div className="grid gap-6 sm:grid-cols-2">
                        <div className="rounded-2xl bg-slate-50 p-4 dark:bg-slate-950">
                          <div className="text-xs uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                            Email
                          </div>
                          <div className="mt-2 text-sm font-medium text-slate-900 dark:text-white">
                            {account.developer.email}
                          </div>
                        </div>
                        <div className="rounded-2xl bg-slate-50 p-4 dark:bg-slate-950">
                          <div className="text-xs uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                            Current plan
                          </div>
                          <div className="mt-2">
                            <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${tierInfo.badgeClassName}`}>
                              {tierInfo.label}
                            </span>
                          </div>
                        </div>
                        <div className="rounded-2xl bg-slate-50 p-4 dark:bg-slate-950">
                          <div className="text-xs uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                            Member since
                          </div>
                          <div className="mt-2 text-sm font-medium text-slate-900 dark:text-white">
                            {formatMemberSince(account.developer.created_at)}
                          </div>
                        </div>
                        <div className="rounded-2xl bg-slate-50 p-4 dark:bg-slate-950">
                          <div className="text-xs uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                            Developer ID
                          </div>
                          <div className="mt-2 text-sm font-medium text-slate-900 dark:text-white font-mono">
                            {account.developer.id}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-[28px] border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
                    <div className="flex items-center justify-between border-b border-slate-200 bg-slate-950 px-5 py-3 dark:border-slate-800">
                      <span className="text-xs font-medium uppercase tracking-[0.16em] text-slate-400">
                        Change password
                      </span>
                    </div>
                    <div className="space-y-4 p-6">
                      {passwordSuccess && (
                        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200">
                          Password changed successfully
                        </div>
                      )}
                      {passwordError && (
                        <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200">
                          {passwordError}
                        </div>
                      )}
                      <div>
                        <label htmlFor="current-password" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                          Current password
                        </label>
                        <input
                          id="current-password"
                          type="password"
                          value={passwordForm.currentPassword}
                          onChange={(e) => setPasswordForm({ ...passwordForm, currentPassword: e.target.value })}
                          className="mt-1 block w-full rounded-xl border border-slate-300 px-4 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                        />
                      </div>
                      <div>
                        <label htmlFor="new-password" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                          New password
                        </label>
                        <input
                          id="new-password"
                          type="password"
                          value={passwordForm.newPassword}
                          onChange={(e) => setPasswordForm({ ...passwordForm, newPassword: e.target.value })}
                          className="mt-1 block w-full rounded-xl border border-slate-300 px-4 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                        />
                      </div>
                      <div>
                        <label htmlFor="confirm-password" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                          Confirm new password
                        </label>
                        <input
                          id="confirm-password"
                          type="password"
                          value={passwordForm.confirmPassword}
                          onChange={(e) => setPasswordForm({ ...passwordForm, confirmPassword: e.target.value })}
                          className="mt-1 block w-full rounded-xl border border-slate-300 px-4 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => void handleChangePassword()}
                        disabled={changingPassword || !passwordForm.currentPassword || !passwordForm.newPassword || !passwordForm.confirmPassword}
                        className="inline-flex items-center justify-center rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {changingPassword ? "Changing password..." : "Change password"}
                      </button>
                    </div>
                  </div>

                  <div className="rounded-[28px] border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
                    <div className="flex items-center justify-between border-b border-slate-200 bg-slate-950 px-5 py-3 dark:border-slate-800">
                      <span className="text-xs font-medium uppercase tracking-[0.16em] text-slate-400">
                        Notification preferences
                      </span>
                      <button
                        type="button"
                        onClick={() => void handleSavePreferences()}
                        disabled={saving}
                        className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 transition hover:border-slate-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {saving ? "Saving..." : "Save changes"}
                      </button>
                    </div>
                    <div className="space-y-6 p-6">
                      <div>
                        <div className="mb-3 text-sm font-medium text-slate-900 dark:text-white">
                          Email alerts
                        </div>
                        <RadioGroup
                          name="email-alerts"
                          options={emailAlertOptions}
                          value={preferences.email_alert_frequency}
                          onChange={(v) => updatePreference("email_alert_frequency", v)}
                        />
                      </div>
                      <div>
                        <div className="mb-3 flex items-center justify-between">
                          <div>
                            <div className="text-sm font-medium text-slate-900 dark:text-white">
                              Deal digest emails
                            </div>
                            <div className="text-xs text-slate-500 dark:text-slate-400">
                              Receive periodic emails about deals and price drops
                            </div>
                          </div>
                          <button
                            type="button"
                            role="switch"
                            aria-checked={preferences.deal_digest}
                            onClick={() => updatePreference("deal_digest", !preferences.deal_digest)}
                            className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 ${
                              preferences.deal_digest ? "bg-indigo-600" : "bg-slate-200 dark:bg-slate-700"
                            }`}
                          >
                            <span
                              aria-hidden="true"
                              className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                                preferences.deal_digest ? "translate-x-5" : "translate-x-0"
                              }`}
                            />
                          </button>
                        </div>
                      </div>
                      {saveSuccess && (
                        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200">
                          Preferences saved successfully
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="rounded-[28px] border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
                    <div className="flex items-center justify-between border-b border-slate-200 bg-slate-950 px-5 py-3 dark:border-slate-800">
                      <span className="text-xs font-medium uppercase tracking-[0.16em] text-slate-400">
                        API access
                      </span>
                    </div>
                    <div className="p-6">
                      <div className="mb-4">
                        <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
                          Manage your API key
                        </h2>
                        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                          View, rotate, and manage your BuyWhere API credentials.
                        </p>
                      </div>
                      <Link
                        href="/dashboard"
                        className="inline-flex items-center justify-center rounded-xl bg-indigo-600 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-indigo-700"
                      >
                        Go to dashboard
                      </Link>
                    </div>
                  </div>

                  <div className="rounded-[28px] border border-rose-200 bg-rose-50 dark:border-rose-500/30 dark:bg-rose-500/10">
                    <div className="flex items-center justify-between border-b border-rose-200 bg-rose-950 px-5 py-3 dark:border-rose-500/30">
                      <span className="text-xs font-medium uppercase tracking-[0.16em] text-rose-400">
                        Danger zone
                      </span>
                    </div>
                    <div className="p-6">
                      <div className="mb-4">
                        <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
                          Delete account
                        </h2>
                        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                          Permanently delete your account and all associated data. This action cannot be undone.
                        </p>
                      </div>
                      {deleteError && (
                        <div className="mb-4 rounded-xl border border-rose-200 bg-rose-100 p-3 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/20 dark:text-rose-200">
                          {deleteError}
                        </div>
                      )}
                      <div className="mb-4">
                        <label htmlFor="delete-confirm" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                          Type <span className="font-mono font-bold">DELETE</span> to confirm
                        </label>
                        <input
                          id="delete-confirm"
                          type="text"
                          value={deleteConfirmText}
                          onChange={(e) => setDeleteConfirmText(e.target.value)}
                          placeholder="DELETE"
                          className="mt-1 block w-full rounded-xl border border-slate-300 px-4 py-2 text-sm focus:border-rose-500 focus:outline-none focus:ring-2 focus:ring-rose-500/20 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => void handleDeleteAccount()}
                        disabled={deleting || deleteConfirmText !== "DELETE"}
                        className="inline-flex items-center justify-center rounded-xl bg-rose-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {deleting ? "Deleting account..." : "Delete account"}
                      </button>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
}