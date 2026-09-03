"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

export function LeadCaptureForm() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;

    setStatus("loading");
    setError("");

    try {
      const res = await fetch("https://api.buywhere.ai/v1/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, source: "website-landing" }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error?.message || "Failed to submit");
      }

      setStatus("success");
      setEmail("");
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Something went wrong");
    }
  };

  if (status === "success") {
    return (
      <div className="bg-white/10 rounded-lg p-4 max-w-md mx-auto">
        <p className="text-white font-medium">Thanks! We&apos;ll be in touch soon.</p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-3 max-w-md mx-auto">
      <Input
        type="email"
        placeholder="Enter your work email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
        inputSize="lg"
        className="flex-1 bg-white text-gray-900"
        aria-label="Work email"
      />
      <Button
        type="submit"
        size="lg"
        disabled={status === "loading"}
        className="bg-indigo-600 text-white hover:bg-indigo-700 whitespace-nowrap"
      >
        {status === "loading" ? "Submitting..." : "Get Early Access"}
      </Button>
      {error && (
        <p className="text-red-300 text-sm mt-2">{error}</p>
      )}
    </form>
  );
}