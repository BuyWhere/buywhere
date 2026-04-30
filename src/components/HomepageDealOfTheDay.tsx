import Image from "next/image";
import Link from "next/link";
import { DealRefreshCountdown } from "@/components/DealRefreshCountdown";
import type { FeaturedDeal } from "@/lib/deal-of-the-day";
import { formatCurrency } from "@/lib/deal-of-the-day";

const RETAILER_STYLES: Record<string, string> = {
  Amazon: "bg-orange-100 text-orange-900 ring-orange-200",
  Walmart: "bg-blue-100 text-blue-900 ring-blue-200",
  Target: "bg-rose-100 text-rose-900 ring-rose-200",
  "Best Buy": "bg-sky-100 text-sky-900 ring-sky-200",
};

function initialsForRetailer(retailer: string) {
  return retailer
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
}

function SavingsChip({ deal }: { deal: FeaturedDeal }) {
  if (deal.savingsPct === null && deal.savingsAmount === null) {
    return null;
  }

  return (
    <div className="inline-flex items-center rounded-full bg-emerald-100 px-3 py-1 text-sm font-semibold text-emerald-900">
      {deal.savingsPct !== null ? `${Math.round(deal.savingsPct)}% below reference` : "Price drop detected"}
    </div>
  );
}

function FeaturedDealCard({ deal }: { deal: FeaturedDeal }) {
  const retailerStyle = RETAILER_STYLES[deal.retailer] || "bg-slate-100 text-slate-900 ring-slate-200";

  return (
    <div className="relative overflow-hidden rounded-[32px] border border-amber-200/80 bg-[linear-gradient(145deg,#fffaf0_0%,#ffffff_40%,#eef4ff_100%)] shadow-[0_30px_90px_-40px_rgba(15,23,42,0.5)]">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-amber-400 to-transparent" />
      <div className="absolute -left-12 top-8 h-32 w-32 rounded-full bg-amber-200/45 blur-3xl" />
      <div className="absolute -right-10 bottom-10 h-40 w-40 rounded-full bg-sky-200/35 blur-3xl" />

      <div className="relative grid gap-8 px-6 py-7 sm:px-8 lg:grid-cols-[minmax(0,1.2fr)_320px] lg:gap-10 lg:px-10 lg:py-10">
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-3">
            <span className="inline-flex items-center rounded-full bg-slate-950 px-3 py-1 text-xs font-semibold uppercase tracking-[0.24em] text-white">
              Deal of the day
            </span>
            <span className="inline-flex items-center rounded-full bg-white/90 px-3 py-1 text-sm text-slate-600 ring-1 ring-amber-200">
              Refreshes in <span className="ml-2"><DealRefreshCountdown refreshAtIso={deal.refreshAtIso} /></span>
            </span>
          </div>

          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <span className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-semibold ring-1 ${retailerStyle}`}>
                {deal.retailer}
              </span>
              <SavingsChip deal={deal} />
            </div>

            <div>
              <p className="text-sm font-medium uppercase tracking-[0.2em] text-amber-700">Featured homepage pick</p>
              <h2 className="mt-2 max-w-3xl text-3xl font-semibold leading-tight text-slate-950 sm:text-4xl">
                {deal.name}
              </h2>
            </div>

            <p className="max-w-2xl text-base leading-7 text-slate-600">
              A single high-signal offer surfaced for today so returning shoppers can see the best current opportunity without scanning the full catalog.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-3xl bg-white/80 p-4 ring-1 ring-slate-200/80 backdrop-blur">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Current price</p>
              <p className="mt-3 text-3xl font-semibold text-slate-950">
                {formatCurrency(deal.currentPrice, deal.currency)}
              </p>
            </div>
            <div className="rounded-3xl bg-white/80 p-4 ring-1 ring-slate-200/80 backdrop-blur">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">{deal.referenceLabel}</p>
              <p className="mt-3 text-2xl font-semibold text-slate-950">
                {deal.referencePrice !== null ? formatCurrency(deal.referencePrice, deal.currency) : "Updating"}
              </p>
            </div>
            <div className="rounded-3xl bg-slate-950 p-4 text-white shadow-lg shadow-slate-950/20">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-300">You save</p>
              <p className="mt-3 text-2xl font-semibold">
                {deal.savingsAmount !== null ? formatCurrency(deal.savingsAmount, deal.currency) : "Live deal"}
              </p>
              <p className="mt-1 text-sm text-slate-300">
                {deal.savingsPct !== null ? `${Math.round(deal.savingsPct)}% below the reference price` : "Best visible daily offer"}
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <a
              href={deal.destinationUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center rounded-2xl bg-slate-950 px-6 py-3 text-sm font-semibold text-white transition-transform hover:-translate-y-0.5 hover:bg-slate-800"
            >
              Get this deal
            </a>
            <Link
              href="/deals/us"
              className="inline-flex items-center justify-center rounded-2xl border border-slate-200 bg-white px-6 py-3 text-sm font-semibold text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50"
            >
              Browse more live deals
            </Link>
            <p className="text-sm text-slate-500">Resets at 00:00 UTC every day.</p>
          </div>
        </div>

        <div className="relative">
          <div className="relative overflow-hidden rounded-[28px] border border-white/70 bg-white/90 shadow-[0_18px_50px_-30px_rgba(15,23,42,0.6)]">
            <div className="absolute inset-x-0 top-0 z-10 flex items-center justify-between border-b border-slate-200/80 bg-white/85 px-4 py-3 backdrop-blur">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Today&apos;s spotlight</p>
              <span className="text-xs text-slate-400">{initialsForRetailer(deal.retailer)}</span>
            </div>
            <div className="relative aspect-[4/5] bg-[radial-gradient(circle_at_top,#fff4d6_0%,#f8fafc_52%,#e2e8f0_100%)]">
              {deal.imageUrl ? (
                <Image
                  src={deal.imageUrl}
                  alt={deal.name}
                  fill
                  priority
                  sizes="(max-width: 1024px) 100vw, 320px"
                  className="object-contain p-8"
                />
              ) : (
                <div className="flex h-full items-center justify-center">
                  <div className="flex h-28 w-28 items-center justify-center rounded-full bg-white/80 text-3xl font-semibold text-slate-900 shadow-sm">
                    {initialsForRetailer(deal.retailer)}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function EmptyDealState() {
  return (
    <div className="relative overflow-hidden rounded-[32px] border border-slate-200 bg-[linear-gradient(145deg,#f8fafc_0%,#ffffff_52%,#eef2ff_100%)] px-6 py-7 shadow-[0_30px_90px_-40px_rgba(15,23,42,0.35)] sm:px-8 lg:px-10 lg:py-10">
      <div className="absolute -right-10 top-12 h-40 w-40 rounded-full bg-indigo-100 blur-3xl" />
      <div className="relative flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-2xl">
          <span className="inline-flex items-center rounded-full bg-slate-950 px-3 py-1 text-xs font-semibold uppercase tracking-[0.24em] text-white">
            Deal of the day
          </span>
          <h2 className="mt-4 text-3xl font-semibold text-slate-950 sm:text-4xl">
            The next featured deal is being prepared.
          </h2>
          <p className="mt-3 text-base leading-7 text-slate-600">
            This placement is live on the homepage and will populate automatically once the daily featured-deal feed responds.
          </p>
        </div>
        <Link
          href="/deals/us"
          className="inline-flex items-center justify-center rounded-2xl bg-slate-950 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-slate-800"
        >
          Browse live deals
        </Link>
      </div>
    </div>
  );
}

export function HomepageDealOfTheDay({ deal }: { deal: FeaturedDeal | null }) {
  return (
    <section className="relative -mt-10 bg-[linear-gradient(180deg,#111827_0%,#ffffff_24%)] pb-10 pt-4 sm:-mt-12 lg:-mt-16 lg:pb-14">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        {deal ? <FeaturedDealCard deal={deal} /> : <EmptyDealState />}
      </div>
    </section>
  );
}
