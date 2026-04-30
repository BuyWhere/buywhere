"use client";

interface AffiliateDisclosureProps {
  region?: "US" | "SG" | "MY" | "OTHER";
  className?: string;
  variant?: "banner" | "tooltip" | "inline";
}

const DISCLOSURE_MESSAGES: Record<NonNullable<AffiliateDisclosureProps["region"]>, string> = {
  US: "We may earn a commission if you purchase via our links.",
  SG: "We may earn a commission if you purchase via our affiliate links.",
  MY: "We may earn a commission if you purchase via our links.",
  OTHER: "We may earn a commission if you purchase via our links.",
};

export function AffiliateDisclosure({
  region = "US",
  className = "",
  variant = "banner",
}: AffiliateDisclosureProps) {
  const message = DISCLOSURE_MESSAGES[region] || DISCLOSURE_MESSAGES.OTHER;

  if (variant === "tooltip") {
    return (
      <span
        className={`group relative inline-flex items-center ${className}`}
        title={message}
      >
        <svg
          className="w-4 h-4 text-gray-400 hover:text-gray-600 cursor-help"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
        <span
          className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-1.5 text-xs text-white bg-gray-900 rounded-lg shadow-lg opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none whitespace-nowrap z-10"
          role="tooltip"
        >
          {message}
          <svg
            className="absolute top-full left-1/2 -translate-x-1/2 -mt-px w-3 h-3 text-gray-900"
            fill="currentColor"
            viewBox="0 0 12 12"
            aria-hidden="true"
          >
            <path d="M6 10L1 5h10L6 10z" />
          </svg>
        </span>
      </span>
    );
  }

  if (variant === "inline") {
    return (
      <span className={`inline-flex items-center gap-1 text-xs text-gray-500 ${className}`}>
        <svg
          className="w-3.5 h-3.5 flex-shrink-0"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
        {message}
      </span>
    );
  }

  return (
    <div
      className={`inline-flex items-center gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800 ${className}`}
      role="note"
      aria-label="Affiliate disclosure"
    >
      <svg
        className="w-4 h-4 flex-shrink-0 text-amber-600"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
        />
      </svg>
      <span>{message}</span>
    </div>
  );
}

export default AffiliateDisclosure;
