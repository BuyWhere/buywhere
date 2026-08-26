"use client";

import { useState } from "react";

type FormState = {
  contactName: string;
  email: string;
  companyName: string;
  website: string;
  message: string;
};

const INITIAL_STATE: FormState = {
  contactName: "",
  email: "",
  companyName: "",
  website: "",
  message: "",
};

const HONEYPOT_FIELD = "__bw_hp_merchants";

export default function MerchantIntakeForm() {
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
          message: form.message.trim(),
          source: "merchants-page",
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
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-6">
        <div className="flex items-start gap-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-100">
            <svg className="h-5 w-5 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <div>
            <h3 className="font-semibold text-emerald-900">Application received!</h3>
            <p className="mt-1 text-sm text-emerald-700">{success}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setSuccess("")}
          className="mt-4 text-sm font-medium text-emerald-700 underline hover:text-emerald-800"
        >
          Submit another merchant
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      <input type="text" name={HONEYPOT_FIELD} style={{ display: "none" }} tabIndex={-1} autoComplete="off" aria-hidden="true" />
      <div className="grid sm:grid-cols-2 gap-4">
        <div>
          <label htmlFor="merchant-name" className="block text-sm font-medium text-gray-700 mb-1">
            Your name <span className="text-red-500">*</span>
          </label>
          <input
            id="merchant-name"
            type="text"
            value={form.contactName}
            onChange={(e) => updateField("contactName", e.target.value)}
            className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
            placeholder="Jane Smith"
            autoComplete="name"
            required
          />
        </div>
        <div>
          <label htmlFor="merchant-email" className="block text-sm font-medium text-gray-700 mb-1">
            Work email <span className="text-red-500">*</span>
          </label>
          <input
            id="merchant-email"
            type="email"
            value={form.email}
            onChange={(e) => updateField("email", e.target.value)}
            className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
            placeholder="jane@store.com"
            autoComplete="email"
            required
          />
        </div>
      </div>
      <div className="grid sm:grid-cols-2 gap-4">
        <div>
          <label htmlFor="merchant-company" className="block text-sm font-medium text-gray-700 mb-1">
            Store / brand <span className="text-red-500">*</span>
          </label>
          <input
            id="merchant-company"
            type="text"
            value={form.companyName}
            onChange={(e) => updateField("companyName", e.target.value)}
            className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
            placeholder="Acme Electronics"
            autoComplete="organization"
            required
          />
        </div>
        <div>
          <label htmlFor="merchant-website" className="block text-sm font-medium text-gray-700 mb-1">
            Website
          </label>
          <input
            id="merchant-website"
            type="url"
            value={form.website}
            onChange={(e) => updateField("website", e.target.value)}
            className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
            placeholder="https://acme.com"
            autoComplete="url"
          />
        </div>
      </div>
      <div>
        <label htmlFor="merchant-message" className="block text-sm font-medium text-gray-700 mb-1">
          What products do you sell, and how would you feed BuyWhere? <span className="text-red-500">*</span>
        </label>
        <textarea
          id="merchant-message"
          rows={4}
          value={form.message}
          onChange={(e) => updateField("message", e.target.value)}
          className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent resize-none"
          placeholder="We run a 2,000-SKU consumer electronics store in Singapore. We can ship a daily CSV or expose a Shopify admin API token..."
          required
        />
      </div>
      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      ) : null}
      <button
        type="submit"
        disabled={isSubmitting}
        className="w-full bg-emerald-600 text-white font-semibold py-3 rounded-xl hover:bg-emerald-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isSubmitting ? "Sending…" : "List my catalog →"}
      </button>
      <p className="text-xs text-gray-500 text-center">
        We onboard Singapore merchants at no cost during beta. We respond within one business day.
      </p>
    </form>
  );
}