"use client";

import { useState } from "react";

type FormState = {
  contactName: string;
  email: string;
  companyName: string;
  website: string;
  partnershipArea: string;
  message: string;
};

const INITIAL_STATE: FormState = {
  contactName: "",
  email: "",
  companyName: "",
  website: "",
  partnershipArea: "",
  message: "",
};

const HONEYPOT_FIELD = "__bw_hp_partners";

const AREAS = [
  "Attribution & referral",
  "Platform / infrastructure",
  "Demand & distribution",
  "Other",
];

export default function PartnerIntakeForm() {
  const [form, setForm] = useState(INITIAL_STATE);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const updateField = (field: keyof FormState, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSuccess("");

    const formEl = event.currentTarget;
    const honeypot = (formEl.elements.namedItem(HONEYPOT_FIELD) as HTMLInputElement)?.value;
    if (honeypot) {
      setSuccess("Thanks — we will be in touch within one business day.");
      return;
    }

    if (!form.contactName.trim() || !form.email.trim() || !form.companyName.trim() || !form.message.trim()) {
      setError("Name, email, company, and message are required.");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
      setError("Please enter a valid email address.");
      return;
    }
    if (form.website.trim() && !/^https?:\/\/.+/i.test(form.website.trim())) {
      setError("Website must start with http:// or https://.");
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetch("/api/v1/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyName: form.companyName.trim(),
          contactName: form.contactName.trim(),
          email: form.email.trim(),
          website: form.website.trim(),
          message: form.partnershipArea
            ? `[${form.partnershipArea}] ${form.message.trim()}`
            : form.message.trim(),
          source: "partners-page",
        }),
      });

      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        setError(payload.error || "Something went wrong. Please try again.");
        return;
      }

      setSuccess(payload.message || "Thanks — we will be in touch within one business day.");
      setForm(INITIAL_STATE);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  if (success) {
    return (
      <div className="rounded-xl border border-violet-200 bg-violet-50 p-6">
        <div className="flex items-start gap-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-violet-100">
            <svg className="h-5 w-5 text-violet-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <div>
            <h3 className="font-semibold text-violet-900">Partnership inquiry received!</h3>
            <p className="mt-1 text-sm text-violet-700">{success}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setSuccess("")}
          className="mt-4 text-sm font-medium text-violet-700 underline hover:text-violet-800"
        >
          Send another partnership inquiry
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      <input type="text" name={HONEYPOT_FIELD} style={{ display: "none" }} tabIndex={-1} autoComplete="off" aria-hidden="true" />
      <div className="grid sm:grid-cols-2 gap-4">
        <div>
          <label htmlFor="partner-name" className="block text-sm font-medium text-gray-700 mb-1">
            Your name <span className="text-red-500">*</span>
          </label>
          <input
            id="partner-name"
            type="text"
            value={form.contactName}
            onChange={(e) => updateField("contactName", e.target.value)}
            className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent"
            placeholder="Jane Smith"
            autoComplete="name"
            required
          />
        </div>
        <div>
          <label htmlFor="partner-email" className="block text-sm font-medium text-gray-700 mb-1">
            Work email <span className="text-red-500">*</span>
          </label>
          <input
            id="partner-email"
            type="email"
            value={form.email}
            onChange={(e) => updateField("email", e.target.value)}
            className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent"
            placeholder="jane@partner.com"
            autoComplete="email"
            required
          />
        </div>
      </div>
      <div className="grid sm:grid-cols-2 gap-4">
        <div>
          <label htmlFor="partner-company" className="block text-sm font-medium text-gray-700 mb-1">
            Company <span className="text-red-500">*</span>
          </label>
          <input
            id="partner-company"
            type="text"
            value={form.companyName}
            onChange={(e) => updateField("companyName", e.target.value)}
            className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent"
            placeholder="Partner Inc."
            autoComplete="organization"
            required
          />
        </div>
        <div>
          <label htmlFor="partner-area" className="block text-sm font-medium text-gray-700 mb-1">
            Partnership area
          </label>
          <select
            id="partner-area"
            value={form.partnershipArea}
            onChange={(e) => updateField("partnershipArea", e.target.value)}
            className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent text-gray-700"
          >
            <option value="">Select an area…</option>
            {AREAS.map((area) => (
              <option key={area} value={area}>{area}</option>
            ))}
          </select>
        </div>
      </div>
      <div>
        <label htmlFor="partner-website" className="block text-sm font-medium text-gray-700 mb-1">
          Website
        </label>
        <input
          id="partner-website"
          type="url"
          value={form.website}
          onChange={(e) => updateField("website", e.target.value)}
          className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent"
          placeholder="https://partner.com"
          autoComplete="url"
        />
      </div>
      <div>
        <label htmlFor="partner-message" className="block text-sm font-medium text-gray-700 mb-1">
          Tell us what you want to build <span className="text-red-500">*</span>
        </label>
        <textarea
          id="partner-message"
          rows={4}
          value={form.message}
          onChange={(e) => updateField("message", e.target.value)}
          className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent resize-none"
          placeholder="We run a comparison engine and want to wire BuyWhere products into our attribution layer..."
          required
        />
      </div>
      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      ) : null}
      <button
        type="submit"
        disabled={isSubmitting}
        className="w-full bg-violet-600 text-white font-semibold py-3 rounded-xl hover:bg-violet-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isSubmitting ? "Sending…" : "Propose a partnership →"}
      </button>
      <p className="text-xs text-gray-500 text-center">
        We respond to partnership inquiries within one business day.
      </p>
    </form>
  );
}