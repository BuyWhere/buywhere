"use client";

import { useEffect, useState } from "react";

/**
 * Sticky in-page anchor that jumps to the "live deals" snapshot section.
 *
 * Rendered unconditionally in SSR (so it works without JS as a plain
 * fragment-anchor link) and progressively enhanced on the client:
 *   - becomes visible after the hero scrolls past y=0
 *   - hides once `#live-deals` enters the viewport (IntersectionObserver)
 *   - skips the visibility animation under prefers-reduced-motion — the
 *     anchor stays visible-but-static.
 *
 * BUY-74692 (VidMee UX regression on /best-gaming-laptops-us at 1440×900):
 * shoppers couldn't reach the Live Catalog Snapshot conversion units
 * (retailer prices + Buy links) above the 836-px fold.
 */
export function SeoLandingStickyAnchor({ label = "↓ View live deals" }: { label?: string }) {
  // SSR + no-JS fallback: start visible so the anchor is always useful
  // (browsers that don't run JS still get a working fragment-anchor link
  // at a known sticky position). The client effect hides it once the
  // snapshot section enters the viewport.
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;

    const target = document.getElementById("live-deals");
    if (!target) return; // Defensive: page without the anchor target.

    // Reduced-motion users: keep anchor visible-but-static; no IO dance.
    if (reduceMotion) {
      return undefined;
    }

    if (!("IntersectionObserver" in window)) {
      // Fallback: hide once the target has been scrolled past (best-effort).
      const onScroll = () => {
        const rect = target.getBoundingClientRect();
        setHidden(rect.top <= 200);
      };
      onScroll();
      const w: Window = window;
      w.addEventListener("scroll", onScroll, { passive: true });
      return () => w.removeEventListener("scroll", onScroll);
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          // Hide once the snapshot section is in view — the anchor has done
          // its job. Keep it visible (sticky at top of viewport) while the
          // shopper is still above the snapshot.
          setHidden(entry.isIntersecting);
        }
      },
      { rootMargin: "-64px 0px 0px 0px" } // account for sticky site header
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, []);

  return (
    <a
      href="#live-deals"
      data-testid="seo-landing-sticky-anchor"
      className={`sticky top-16 z-40 block bg-white/90 backdrop-blur border-b border-slate-200 px-4 sm:px-6 py-3 text-center text-sm font-semibold text-amber-900 hover:text-amber-950 underline-offset-4 hover:underline transition-opacity ${
        hidden ? "opacity-0 pointer-events-none" : "opacity-100"
      }`}
      aria-hidden={hidden ? "true" : "false"}
      tabIndex={hidden ? -1 : 0}
    >
      {label}
    </a>
  );
}
