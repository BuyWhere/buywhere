"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  {
    href: "/dashboard",
    label: "Overview",
    description: "Keys, usage, and developer resources",
  },
  {
    href: "/alerts",
    label: "Alerts",
    description: "Webhook subscriptions and delivery history",
  },
  {
    href: "/billing",
    label: "Billing",
    description: "Plan status and upgrade path",
  },
  {
    href: "/account",
    label: "Account",
    description: "Profile, notifications, and settings",
  },
];

export default function DashboardSidebar() {
  const pathname = usePathname();

  return (
    <aside className="self-start xl:sticky xl:top-24">
      <div className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="border-b border-slate-200 bg-slate-950 px-5 py-4 dark:border-slate-800">
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
            Dashboard
          </div>
          <p className="mt-2 text-sm text-slate-300">
            Navigate the developer workspace.
          </p>
        </div>
        <nav className="space-y-2 p-3">
          {NAV_ITEMS.map((item) => {
            const active = pathname === item.href;

            return (
              <Link
                key={item.href}
                href={item.href}
                className={`block rounded-2xl px-4 py-3 transition ${
                  active
                    ? "bg-indigo-50 text-slate-950 ring-1 ring-indigo-200 dark:bg-indigo-500/10 dark:text-white dark:ring-indigo-500/30"
                    : "text-slate-600 hover:bg-slate-50 hover:text-slate-950 dark:text-slate-300 dark:hover:bg-slate-950 dark:hover:text-white"
                }`}
              >
                <div className="text-sm font-semibold">{item.label}</div>
                <div className={`mt-1 text-xs ${active ? "text-slate-600 dark:text-slate-300" : "text-slate-400"}`}>
                  {item.description}
                </div>
              </Link>
            );
          })}
        </nav>
      </div>
    </aside>
  );
}
