"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useDeveloperAuth } from "@/lib/developer-auth";

function getInitials(email: string) {
  const [name = ""] = email.split("@");
  const segments = name.split(/[._-]+/).filter(Boolean);

  if (segments.length >= 2) {
    return `${segments[0][0] ?? ""}${segments[1][0] ?? ""}`.toUpperCase();
  }

  return name.slice(0, 2).toUpperCase() || "BW";
}

function getEmailLabel(email: string) {
  if (email.length <= 24) {
    return email;
  }

  const [name, domain] = email.split("@");
  if (!domain) {
    return `${email.slice(0, 21)}...`;
  }

  return `${name.slice(0, 10)}...@${domain}`;
}

interface AuthNavControlsProps {
  mobile?: boolean;
  onNavigate?: () => void;
}

export default function AuthNavControls({
  mobile = false,
  onNavigate,
}: AuthNavControlsProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { developer, isAuthenticated, signOut, status } = useDeveloperAuth();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (mobile || !open) {
      return;
    }

    function handlePointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [mobile, open]);

  async function handleSignOut() {
    await signOut();
    setOpen(false);
    onNavigate?.();
    router.refresh();
  }

  if (!isAuthenticated || !developer) {
    const nextPath = pathname || "/dashboard";
    const signInHref = `/login?next=${encodeURIComponent(nextPath)}`;

    if (mobile) {
      return (
        <>
          <Link
            href={signInHref}
            onClick={onNavigate}
            className="rounded-xl border border-slate-200 px-4 py-2 text-center text-slate-700 transition-colors hover:border-indigo-200 hover:text-indigo-600 dark:border-slate-700 dark:text-slate-100 dark:hover:border-indigo-400/40 dark:hover:text-indigo-300"
          >
            {status === "loading" ? "Checking session..." : "Sign in"}
          </Link>
          <Link
            href="/api-keys"
            onClick={onNavigate}
            className="rounded-xl bg-indigo-600 px-4 py-2 text-center font-semibold text-white transition-colors hover:bg-indigo-700"
          >
            Get API Key
          </Link>
        </>
      );
    }

    return (
      <div className="ml-2 flex items-center gap-3">
        <Link
          href={signInHref}
          className="transition-colors hover:text-indigo-600 dark:hover:text-indigo-400"
        >
          {status === "loading" ? "Checking session..." : "Sign in"}
        </Link>
        <Link
          href="/api-keys"
          className="rounded-lg bg-indigo-600 px-4 py-2 text-white transition-colors hover:bg-indigo-700"
        >
          Get API Key
        </Link>
      </div>
    );
  }

  const initials = getInitials(developer.email);

  if (mobile) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950/60">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-indigo-600 text-sm font-semibold text-white">
            {initials}
          </div>
          <div className="min-w-0">
            <div className="text-xs uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
              Signed in
            </div>
            <div className="truncate text-sm font-semibold text-slate-900 dark:text-white">
              {developer.email}
            </div>
          </div>
        </div>
        <div className="mt-4 flex flex-col gap-2">
          <Link href="/account" onClick={onNavigate} className="rounded-xl px-3 py-2 hover:bg-white hover:text-indigo-600 dark:hover:bg-slate-900 dark:hover:text-indigo-300">
            Account
          </Link>
          <Link href="/alerts" onClick={onNavigate} className="rounded-xl px-3 py-2 hover:bg-white hover:text-indigo-600 dark:hover:bg-slate-900 dark:hover:text-indigo-300">
            My Alerts
          </Link>
          <Link href="/wishlist" onClick={onNavigate} className="rounded-xl px-3 py-2 hover:bg-white hover:text-indigo-600 dark:hover:bg-slate-900 dark:hover:text-indigo-300">
            My Wishlist
          </Link>
          <Link href="/saved-searches" onClick={onNavigate} className="rounded-xl px-3 py-2 hover:bg-white hover:text-indigo-600 dark:hover:bg-slate-900 dark:hover:text-indigo-300">
            Saved Searches
          </Link>
          <button
            type="button"
            onClick={() => void handleSignOut()}
            className="rounded-xl px-3 py-2 text-left text-rose-600 hover:bg-white dark:text-rose-300 dark:hover:bg-slate-900"
          >
            Sign Out
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative ml-2" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="flex items-center gap-3 rounded-full border border-slate-200 bg-white px-2.5 py-1.5 text-left text-slate-700 shadow-sm transition-colors hover:border-indigo-200 hover:text-indigo-600 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:hover:border-indigo-400/40 dark:hover:text-indigo-300"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-indigo-600 text-xs font-semibold text-white">
          {initials}
        </span>
        <span className="hidden max-w-[180px] truncate text-sm font-medium lg:block">
          {getEmailLabel(developer.email)}
        </span>
        <svg
          width="16"
          height="16"
          viewBox="0 0 20 20"
          fill="none"
          className={`transition-transform ${open ? "rotate-180" : ""}`}
          aria-hidden="true"
        >
          <path d="M5 7.5l5 5 5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Developer navigation"
          className="absolute right-0 mt-3 w-64 overflow-hidden rounded-2xl border border-slate-200 bg-white p-2 shadow-xl dark:border-slate-800 dark:bg-slate-950"
        >
          <div className="border-b border-slate-100 px-3 py-3 dark:border-slate-800">
            <div className="text-xs uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
              Signed in
            </div>
            <div className="mt-1 truncate text-sm font-semibold text-slate-900 dark:text-white">
              {developer.email}
            </div>
          </div>
          <div className="py-2">
            <Link href="/account" className="block rounded-xl px-3 py-2 text-sm text-slate-700 transition-colors hover:bg-slate-50 hover:text-indigo-600 dark:text-slate-200 dark:hover:bg-slate-900 dark:hover:text-indigo-300">
              Account
            </Link>
            <Link href="/alerts" className="block rounded-xl px-3 py-2 text-sm text-slate-700 transition-colors hover:bg-slate-50 hover:text-indigo-600 dark:text-slate-200 dark:hover:bg-slate-900 dark:hover:text-indigo-300">
              My Alerts
            </Link>
            <Link href="/wishlist" className="block rounded-xl px-3 py-2 text-sm text-slate-700 transition-colors hover:bg-slate-50 hover:text-indigo-600 dark:text-slate-200 dark:hover:bg-slate-900 dark:hover:text-indigo-300">
              My Wishlist
            </Link>
            <Link href="/saved-searches" className="block rounded-xl px-3 py-2 text-sm text-slate-700 transition-colors hover:bg-slate-50 hover:text-indigo-600 dark:text-slate-200 dark:hover:bg-slate-900 dark:hover:text-indigo-300">
              Saved Searches
            </Link>
          </div>
          <div className="border-t border-slate-100 px-2 pt-2 dark:border-slate-800">
            <button
              type="button"
              onClick={() => void handleSignOut()}
              className="block w-full rounded-xl px-3 py-2 text-left text-sm font-medium text-rose-600 transition-colors hover:bg-rose-50 dark:text-rose-300 dark:hover:bg-rose-500/10"
            >
              Sign Out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
