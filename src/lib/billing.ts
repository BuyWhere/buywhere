export type BillingTierName = "free" | "starter" | "growth" | "pro" | "scale";
export type CanonicalBillingTierName = "free" | "pro" | "scale";

export interface BillingTierDefinition {
  name: BillingTierName;
  price_monthly: number;
  currency: string;
  requests_per_day: number;
  description: string;
}

export interface BillingStatus {
  tier: BillingTierName;
  requests_today: number;
  requests_limit: number;
  requests_remaining: number;
  subscription_status: string | null;
  current_period_end: string | null;
}

export const FALLBACK_BILLING_TIERS: BillingTierDefinition[] = [
  {
    name: "free",
    price_monthly: 0,
    currency: "USD",
    requests_per_day: 100,
    description: "Free tier for development and testing",
  },
  {
    name: "pro",
    price_monthly: 29,
    currency: "USD",
    requests_per_day: 50000,
    description: "Pro plan for production integrations",
  },
  {
    name: "scale",
    price_monthly: 99,
    currency: "USD",
    requests_per_day: 200000,
    description: "Scale plan for higher-volume API workloads",
  },
];

export const BILLING_TIER_UI: Record<
  CanonicalBillingTierName,
  { label: string; badgeClassName: string; accentClassName: string }
> = {
  free: {
    label: "Free",
    badgeClassName: "bg-slate-100 text-slate-700",
    accentClassName: "text-slate-900",
  },
  pro: {
    label: "Pro",
    badgeClassName: "bg-indigo-100 text-indigo-700",
    accentClassName: "text-indigo-700",
  },
  scale: {
    label: "Scale",
    badgeClassName: "bg-emerald-100 text-emerald-700",
    accentClassName: "text-emerald-700",
  },
};

export function canonicalizeBillingTier(value: string | null | undefined): CanonicalBillingTierName {
  const tier = value?.toLowerCase();

  if (tier === "starter" || tier === "standard" || tier === "premium" || tier === "team" || tier === "pro") {
    return "pro";
  }

  if (tier === "growth" || tier === "scale") {
    return "scale";
  }

  return "free";
}

export function getApiBaseUrl() {
  return process.env.NEXT_PUBLIC_BUYWHERE_API_URL
    ?? process.env.NEXT_PUBLIC_API_URL
    ?? "https://api.buywhere.ai";
}

export function normalizeBillingTiers(payload: unknown): BillingTierDefinition[] {
  const rawTiers = Array.isArray(payload)
    ? payload
    : Array.isArray((payload as { tiers?: unknown[] } | null)?.tiers)
      ? (payload as { tiers: unknown[] }).tiers
      : [];

  const normalized = rawTiers
    .map((tier): BillingTierDefinition | null => {
      if (!tier || typeof tier !== "object") {
        return null;
      }

      const entry = tier as Partial<BillingTierDefinition>;
      if (
        entry.name !== "free"
        && entry.name !== "starter"
        && entry.name !== "growth"
        && entry.name !== "pro"
        && entry.name !== "scale"
      ) {
        return null;
      }

      return {
        name: canonicalizeBillingTier(entry.name),
        price_monthly: Number(entry.price_monthly ?? 0),
        currency: String(entry.currency ?? "USD"),
        requests_per_day: Number(entry.requests_per_day ?? 0),
        description: String(entry.description ?? ""),
      };
    })
    .filter((tier): tier is BillingTierDefinition => tier !== null);

  return normalized.length > 0 ? normalized : FALLBACK_BILLING_TIERS;
}

export function formatPriceMonthly(amount: number, currency: string) {
  if (amount === 0) {
    return "Free";
  }

  return new Intl.NumberFormat("en-SG", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}
