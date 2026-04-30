"use client";

import { useState } from "react";

type ComparisonShareButtonProps = {
  title: string;
};

export default function ComparisonShareButton({ title }: ComparisonShareButtonProps) {
  const [copied, setCopied] = useState(false);

  const handleClick = async () => {
    const url = window.location.href;

    if (navigator.share) {
      try {
        await navigator.share({ title, url });
        return;
      } catch {
        // Fall through to clipboard copy when native share is dismissed or unsupported.
      }
    }

    await navigator.clipboard.writeText(url);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:border-slate-400 hover:text-slate-950"
    >
      {copied ? "Link copied" : "Share comparison"}
    </button>
  );
}
