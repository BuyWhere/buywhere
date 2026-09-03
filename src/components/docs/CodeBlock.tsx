'use client';

import { useState } from "react";

export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        });
      }}
      aria-label={copied ? "Code copied to clipboard" : "Copy code to clipboard"}
      className="text-xs text-gray-400 hover:text-white transition-colors px-2 py-1 rounded border border-gray-700 hover:border-gray-500"
    >
      {copied ? "Copied!" : "Copy"}
    </button>
  );
}

interface CodeBlockProps {
  label: string;
  code: string;
}

export function CodeBlock({ label, code }: CodeBlockProps) {
  return (
    <div className="overflow-hidden rounded-2xl border border-gray-800 bg-gray-950 shadow-[0_24px_80px_rgba(15,23,42,0.32)]">
      <div className="flex items-center justify-between border-b border-gray-800 bg-gray-900/80 px-4 py-2">
        <span className="text-xs font-medium uppercase tracking-[0.22em] text-gray-400">{label}</span>
        <CopyButton text={code} />
      </div>
      <pre className="overflow-x-auto p-4 text-sm leading-6 text-gray-100" role="region" aria-label={`${label} code example`}>
        <code>{code}</code>
      </pre>
    </div>
  );
}
