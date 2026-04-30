"use client";

import React, { useEffect, useState } from "react";
import {
  UPGRADE_INTENT_USE_CASES,
  type UpgradeIntentUseCase,
} from "@/lib/upgrade-intent-schema";

type SubmitStatus = "idle" | "submitting" | "success" | "error";

const useCaseLabels: Record<UpgradeIntentUseCase, string> = {
  personal_project: "Personal project",
  startup: "Startup",
  enterprise: "Enterprise",
};

interface UpgradeModalProps {
  open: boolean;
  onClose: () => void;
  source?: string;
  headline?: string;
  description?: string;
}

export function UpgradeModal({
  open,
  onClose,
  source,
  headline = "Join the Pro launch list",
  description = "Tell us who you are and we’ll email you when Pro billing is ready.",
}: UpgradeModalProps) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [useCase, setUseCase] = useState<UpgradeIntentUseCase>("startup");
  const [status, setStatus] = useState<SubmitStatus>("idle");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) {
      return;
    }

    const savedEmail = window.localStorage.getItem("bw_developer_email");
    const savedName = window.localStorage.getItem("bw_developer_name");

    if (savedEmail) {
      setEmail(savedEmail);
    }

    if (savedName) {
      setName(savedName);
    }
  }, [open]);

  useEffect(() => {
    if (!open) {
      setStatus("idle");
      setError("");
      setCompany("");
      setUseCase("startup");
    }
  }, [open]);

  if (!open) {
    return null;
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    const trimmedName = name.trim();
    const trimmedEmail = email.trim().toLowerCase();
    const trimmedCompany = company.trim();

    if (!trimmedName || !trimmedEmail) {
      setError("Please fill in your name and work email.");
      return;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      setError("Please enter a valid work email.");
      return;
    }

    setStatus("submitting");

    try {
      const response = await fetch("/api/v1/developer/upgrade-intent", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: trimmedName,
          email: trimmedEmail,
          company: trimmedCompany || undefined,
          use_case: useCase,
          source: source ?? null,
        }),
      });

      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(data?.error ?? "Unable to save your upgrade request.");
      }

      window.localStorage.setItem("bw_developer_email", trimmedEmail);
      window.localStorage.setItem("bw_developer_name", trimmedName);
      setStatus("success");
    } catch (caughtError) {
      setStatus("error");
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Unable to save your upgrade request."
      );
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-4"
      onClick={(event) => event.target === event.currentTarget && onClose()}
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="upgrade-intent-title"
      >
        <div className="border-b border-slate-100 bg-[linear-gradient(135deg,#fff8eb_0%,#f7f5ff_100%)] px-6 py-5 sm:px-7">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-amber-700">
                Pro waitlist
              </p>
              <h2 id="upgrade-intent-title" className="mt-2 text-2xl font-semibold text-slate-950">
                {headline}
              </h2>
              <p className="mt-2 max-w-md text-sm leading-6 text-slate-600">
                {description}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-full p-2 text-slate-400 transition-colors hover:bg-white hover:text-slate-600"
              aria-label="Close"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
        </div>

        {status === "success" ? (
          <div className="px-6 py-10 text-center sm:px-7">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
              <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h3 className="mt-5 text-xl font-semibold text-slate-950">
              You&apos;re on the list!
            </h3>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              We&apos;ll email you when Pro launches.
            </p>
            <button
              type="button"
              onClick={onClose}
              className="mt-6 inline-flex items-center justify-center rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-slate-800"
            >
              Close
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="px-6 py-6 sm:px-7">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label htmlFor="upgrade-name" className="mb-1.5 block text-sm font-medium text-slate-700">
                  Name
                </label>
                <input
                  id="upgrade-name"
                  type="text"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  autoComplete="name"
                  className="w-full rounded-xl border border-slate-200 px-3.5 py-3 text-sm text-slate-900 outline-none transition focus:border-amber-300 focus:ring-2 focus:ring-amber-200"
                  placeholder="Jane Smith"
                />
              </div>

              <div className="sm:col-span-2">
                <label htmlFor="upgrade-email" className="mb-1.5 block text-sm font-medium text-slate-700">
                  Work email
                </label>
                <input
                  id="upgrade-email"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  autoComplete="email"
                  className="w-full rounded-xl border border-slate-200 px-3.5 py-3 text-sm text-slate-900 outline-none transition focus:border-amber-300 focus:ring-2 focus:ring-amber-200"
                  placeholder="jane@company.com"
                />
              </div>

              <div>
                <label htmlFor="upgrade-company" className="mb-1.5 block text-sm font-medium text-slate-700">
                  Company
                </label>
                <input
                  id="upgrade-company"
                  type="text"
                  value={company}
                  onChange={(event) => setCompany(event.target.value)}
                  autoComplete="organization"
                  className="w-full rounded-xl border border-slate-200 px-3.5 py-3 text-sm text-slate-900 outline-none transition focus:border-amber-300 focus:ring-2 focus:ring-amber-200"
                  placeholder="Optional"
                />
              </div>

              <div>
                <label htmlFor="upgrade-use-case" className="mb-1.5 block text-sm font-medium text-slate-700">
                  Use case
                </label>
                <select
                  id="upgrade-use-case"
                  value={useCase}
                  onChange={(event) => setUseCase(event.target.value as UpgradeIntentUseCase)}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-3 text-sm text-slate-900 outline-none transition focus:border-amber-300 focus:ring-2 focus:ring-amber-200"
                >
                  {UPGRADE_INTENT_USE_CASES.map((entry) => (
                    <option key={entry} value={entry}>
                      {useCaseLabels[entry]}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {error ? (
              <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {error}
              </div>
            ) : null}

            <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs leading-5 text-slate-500">
                We only use this to contact you about Pro launch availability.
              </p>
              <button
                type="submit"
                disabled={status === "submitting"}
                className="inline-flex items-center justify-center rounded-xl bg-amber-500 px-4 py-3 text-sm font-semibold text-slate-950 transition-colors hover:bg-amber-400 disabled:cursor-wait disabled:opacity-70"
              >
                {status === "submitting" ? "Saving..." : "Notify me when Pro launches"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
