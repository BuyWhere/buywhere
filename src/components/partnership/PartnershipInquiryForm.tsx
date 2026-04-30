"use client";

import { useState } from "react";

type FormState = {
  companyName: string;
  contactName: string;
  email: string;
  website: string;
  message: string;
};

const INITIAL_STATE: FormState = {
  companyName: "",
  contactName: "",
  email: "",
  website: "",
  message: "",
};

const SUCCESS_MESSAGE = "Thanks, we will be in touch within 2 business days";

export default function PartnershipInquiryForm() {
  const [form, setForm] = useState(INITIAL_STATE);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const updateField = (field: keyof FormState, value: string) => {
    setForm((current) => ({
      ...current,
      [field]: value,
    }));
  };

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSuccess("");

    if (!form.companyName.trim() || !form.contactName.trim() || !form.email.trim() || !form.message.trim()) {
      setError("Company name, contact name, email, and message are required.");
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetch("/api/v1/contact", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...form,
          source: "partnership-page",
        }),
      });

      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        setError(payload.error || "Something went wrong. Please try again.");
        return;
      }

      setSuccess(payload.message || SUCCESS_MESSAGE);
      setForm(INITIAL_STATE);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  if (success) {
    return (
      <div className="rounded-[2rem] border border-emerald-200 bg-white p-8 shadow-[0_30px_120px_-60px_rgba(16,185,129,0.65)]">
        <div className="mb-5 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M5 12.5L9.5 17L19 7.5" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <h3 className="text-2xl font-semibold text-slate-950">Inquiry received</h3>
        <p className="mt-3 text-sm leading-7 text-slate-600">{success}</p>
        <button
          type="button"
          onClick={() => setSuccess("")}
          className="mt-6 inline-flex items-center justify-center rounded-full border border-slate-200 px-5 py-2.5 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50"
        >
          Send another inquiry
        </button>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-[2rem] border border-white/60 bg-white p-6 shadow-[0_30px_120px_-60px_rgba(15,23,42,0.45)] sm:p-8"
    >
      <div className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-700">
          Featured placement inquiry
        </p>
        <h2 className="mt-2 text-2xl font-semibold text-slate-950">Tell us about your catalog</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          We review merchant fit, category coverage, and traffic potential before proposing featured placement.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm font-medium text-slate-700">
          Company name
          <input
            type="text"
            value={form.companyName}
            onChange={(event) => updateField("companyName", event.target.value)}
            className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-cyan-500 focus:bg-white focus:ring-4 focus:ring-cyan-100"
            placeholder="Acme Commerce"
            autoComplete="organization"
          />
        </label>

        <label className="block text-sm font-medium text-slate-700">
          Contact name
          <input
            type="text"
            value={form.contactName}
            onChange={(event) => updateField("contactName", event.target.value)}
            className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-cyan-500 focus:bg-white focus:ring-4 focus:ring-cyan-100"
            placeholder="Jane Smith"
            autoComplete="name"
          />
        </label>

        <label className="block text-sm font-medium text-slate-700">
          Work email
          <input
            type="email"
            value={form.email}
            onChange={(event) => updateField("email", event.target.value)}
            className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-cyan-500 focus:bg-white focus:ring-4 focus:ring-cyan-100"
            placeholder="jane@acme.com"
            autoComplete="email"
          />
        </label>

        <label className="block text-sm font-medium text-slate-700">
          Website
          <input
            type="url"
            value={form.website}
            onChange={(event) => updateField("website", event.target.value)}
            className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-cyan-500 focus:bg-white focus:ring-4 focus:ring-cyan-100"
            placeholder="https://acme.com"
            autoComplete="url"
          />
        </label>
      </div>

      <label className="mt-4 block text-sm font-medium text-slate-700">
        Message
        <textarea
          value={form.message}
          onChange={(event) => updateField("message", event.target.value)}
          rows={6}
          className="mt-2 w-full rounded-[1.5rem] border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-cyan-500 focus:bg-white focus:ring-4 focus:ring-cyan-100"
          placeholder="Share your catalog size, target markets, and the categories you want to promote on BuyWhere."
        />
      </label>

      {error ? (
        <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs leading-5 text-slate-500">
          Expect a reply within 2 business days. We use this information only to review partnership fit.
        </p>
        <button
          type="submit"
          disabled={isSubmitting}
          className="inline-flex min-w-[14rem] items-center justify-center rounded-full bg-slate-950 px-6 py-3 text-sm font-semibold text-white transition hover:bg-cyan-700 disabled:cursor-not-allowed disabled:bg-slate-400"
        >
          {isSubmitting ? "Submitting..." : "Request featured placement"}
        </button>
      </div>
    </form>
  );
}
