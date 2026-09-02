"use client";

import { useState } from "react";

export default function NewsletterBanner() {
  const [email, setEmail] = useState("");
  const [honeypot, setHoneypot] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [message, setMessage] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (status === "loading" || status === "success") return;
    setStatus("loading");
    try {
      const res = await fetch("/api/newsletter/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, honeypot, source: "homepage_banner" }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setStatus("success");
        setMessage(data.message ?? "You're subscribed!");
        setEmail("");
      } else {
        setStatus("error");
        setMessage(data.error ?? "Something went wrong. Please try again.");
      }
    } catch {
      setStatus("error");
      setMessage("Network error. Please try again.");
    }
  }

  return (
    <section
      aria-label="Newsletter signup"
      className="bg-indigo-50 border-t border-indigo-100"
    >
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-10">
        <form
          onSubmit={handleSubmit}
          className="flex flex-col sm:flex-row items-center gap-4"
        >
          <div className="flex-1">
            <p className="text-base font-semibold text-indigo-900">
              Get the best deals weekly
            </p>
            <p className="text-sm text-indigo-700 mt-0.5">
              Price drops, new markets, and AI shopping tips — straight to your inbox.
            </p>
          </div>
          {/* Honeypot — hidden from real users */}
          <input
            type="text"
            name="name_confirm"
            value={honeypot}
            onChange={(e) => setHoneypot(e.target.value)}
            aria-hidden="true"
            tabIndex={-1}
            className="hidden"
            autoComplete="off"
          />
          <div className="flex w-full sm:w-auto gap-2">
            <label htmlFor="newsletter-email" className="sr-only">
              Email address
            </label>
            <input
              id="newsletter-email"
              type="email"
              required
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={status === "loading" || status === "success"}
              className="flex-1 sm:w-56 rounded-md border border-indigo-200 bg-white px-3 py-2 text-sm placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-60"
            />
            <button
              type="submit"
              disabled={status === "loading" || status === "success"}
              className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-60 whitespace-nowrap"
            >
              {status === "loading" ? "Subscribing…" : status === "success" ? "Subscribed ✓" : "Subscribe"}
            </button>
          </div>
        </form>
        {message && (
          <p
            className={status === "success" ? "mt-3 text-sm text-green-700" : "mt-3 text-sm text-red-600"}
            role="status"
          >
            {message}
          </p>
        )}
      </div>
    </section>
  );
}
