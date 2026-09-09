"use client";

import { useMemo, useState } from "react";
import {
  buildShareMessage,
  getAbsoluteShareUrl,
  getWhatsAppShareHref,
  getXShareHref,
  trackShareClick,
} from "@/lib/share";

type ShareDealActionsProps = {
  productId: number;
  productName: string;
  productUrl?: string;
  merchant?: string | null;
  priceText?: string | null;
  variant?: "inline" | "menu";
  className?: string;
};

function XIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M18.901 2H21.98l-6.726 7.687L23.167 22h-6.192l-4.849-6.33L6.587 22H3.506l7.193-8.221L1.167 2h6.349l4.383 5.779L18.901 2Zm-1.079 18.16h1.706L6.579 3.744H4.748L17.822 20.16Z" />
    </svg>
  );
}

function WhatsAppIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M20.52 3.48A11.86 11.86 0 0 0 12.08 0C5.48 0 .12 5.36.12 11.96c0 2.1.55 4.15 1.59 5.95L0 24l6.28-1.64a11.9 11.9 0 0 0 5.8 1.48h.01c6.59 0 11.95-5.36 11.95-11.96 0-3.19-1.24-6.19-3.52-8.4Zm-8.44 18.35h-.01a9.9 9.9 0 0 1-5.04-1.38l-.36-.21-3.73.98 1-3.64-.24-.37a9.9 9.9 0 0 1-1.53-5.25c0-5.46 4.45-9.9 9.92-9.9 2.64 0 5.12 1.03 6.98 2.9a9.82 9.82 0 0 1 2.9 7c0 5.46-4.45 9.9-9.89 9.9Zm5.43-7.42c-.3-.15-1.77-.87-2.05-.97-.27-.1-.46-.15-.66.15-.2.3-.76.96-.94 1.16-.17.2-.35.22-.65.08-.3-.15-1.28-.47-2.43-1.5-.9-.8-1.51-1.8-1.69-2.1-.18-.3-.02-.46.13-.6.14-.14.3-.35.45-.52.15-.18.2-.3.3-.5.1-.2.05-.38-.03-.52-.08-.15-.66-1.6-.9-2.18-.24-.58-.49-.5-.66-.51h-.56c-.2 0-.52.08-.8.38-.27.3-1.04 1.01-1.04 2.46s1.07 2.86 1.22 3.06c.15.2 2.1 3.21 5.08 4.5.71.3 1.26.48 1.69.61.71.23 1.36.2 1.87.12.57-.08 1.77-.72 2.02-1.41.25-.7.25-1.3.17-1.42-.07-.12-.27-.2-.57-.35Z" />
    </svg>
  );
}

function LinkIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className={className} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M13.828 10.172a4 4 0 0 1 0 5.656l-3 3a4 4 0 1 1-5.656-5.656l1.5-1.5M10.172 13.828a4 4 0 0 1 0-5.656l3-3a4 4 0 1 1 5.656 5.656l-1.5 1.5" />
    </svg>
  );
}

function ShareIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className={className} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 1 1 0-2.684m0 2.684 6.632 3.316m-6.632-6 6.632-3.316m0 0a3 3 0 1 0 5.367-2.684 3 3 0 0 0-5.367 2.684Zm0 9.316a3 3 0 1 0 5.368 2.684 3 3 0 0 0-5.368-2.684Z" />
    </svg>
  );
}

export default function ShareDealActions({
  productId,
  productName,
  productUrl,
  merchant,
  priceText,
  variant = "inline",
  className = "",
}: ShareDealActionsProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const shareUrl = useMemo(() => getAbsoluteShareUrl(productUrl), [productUrl]);
  const shareMessage = useMemo(
    () =>
      buildShareMessage({
        productName,
        priceText,
        merchant,
        url: shareUrl,
      }),
    [merchant, priceText, productName, shareUrl]
  );

  const handleCopyLink = async (event?: React.MouseEvent) => {
    event?.preventDefault();
    event?.stopPropagation();
    await navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setMenuOpen(false);
    window.setTimeout(() => setCopied(false), 2000);
    void trackShareClick({ productId, channel: "copy", url: shareUrl });
  };

  const handleNativeShare = async (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();

    if (navigator.share) {
      try {
        await navigator.share({
          title: productName,
          text: shareMessage,
          url: shareUrl,
        });
        void trackShareClick({ productId, channel: "native", url: shareUrl });
        return;
      } catch {
        // Fall back to the desktop menu when native share is unavailable or dismissed.
      }
    }

    setMenuOpen((current) => !current);
  };

  const handleTrackedOutboundClick = (channel: "x" | "whatsapp") => (event: React.MouseEvent<HTMLAnchorElement>) => {
    event.stopPropagation();
    void trackShareClick({ productId, channel, url: shareUrl });
    setMenuOpen(false);
  };

  if (variant === "menu") {
    return (
      <div className={`relative ${className}`}>
        <button
          type="button"
          onClick={handleNativeShare}
          aria-label="Share this deal"
          aria-expanded={menuOpen}
          className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/80 bg-white/95 text-slate-700 shadow-sm transition hover:border-slate-300 hover:text-slate-950"
        >
          {copied ? <span className="text-[11px] font-semibold">Done</span> : <ShareIcon />}
        </button>
        {menuOpen ? (
          <div className="absolute right-0 top-12 z-20 flex min-w-[180px] flex-col rounded-2xl border border-slate-200 bg-white p-2 shadow-xl">
            <a
              href={getXShareHref(shareMessage)}
              target="_blank"
              rel="noopener noreferrer"
              onClick={handleTrackedOutboundClick("x")}
              className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 hover:text-slate-950"
            >
              <XIcon />
              Share on X
            </a>
            <a
              href={getWhatsAppShareHref(shareMessage)}
              target="_blank"
              rel="noopener noreferrer"
              onClick={handleTrackedOutboundClick("whatsapp")}
              className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 hover:text-slate-950"
            >
              <WhatsAppIcon />
              Share on WhatsApp
            </a>
            <button
              type="button"
              onClick={handleCopyLink}
              className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 hover:text-slate-950"
            >
              <LinkIcon />
              {copied ? "Link copied" : "Copy link"}
            </button>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className={`flex flex-col gap-3 ${className}`}>
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-indigo-200">Share this deal</p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <a
          href={getXShareHref(shareMessage)}
          target="_blank"
          rel="noopener noreferrer"
          onClick={handleTrackedOutboundClick("x")}
          className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/15 bg-slate-950/25 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-950/40"
        >
          <XIcon />
          Share on X
        </a>
        <a
          href={getWhatsAppShareHref(shareMessage)}
          target="_blank"
          rel="noopener noreferrer"
          onClick={handleTrackedOutboundClick("whatsapp")}
          className="inline-flex items-center justify-center gap-2 rounded-xl border border-emerald-300/20 bg-emerald-500/20 px-4 py-3 text-sm font-semibold text-white transition hover:bg-emerald-500/30"
        >
          <WhatsAppIcon />
          Share on WhatsApp
        </a>
        <button
          type="button"
          onClick={handleCopyLink}
          className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/10 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/18"
        >
          <LinkIcon />
          {copied ? "Link copied" : "Copy link"}
        </button>
      </div>
    </div>
  );
}
