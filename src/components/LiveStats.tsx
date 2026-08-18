// Live platform numbers, straight from the production API (ISR, 5-min refresh).
// Renders nothing if the stats endpoint is unreachable — the page must never
// block or error on this strip.

type Stats = {
  products_indexed: number;
  merchants_total: number;
  merchants_with_products: number;
  requests_24h: number;
  outbound_clicks_7d: number;
  updated_at: string;
};

function compact(n: number): string {
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(1).replace(/\.0$/, "") + "B";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, "") + "K";
  return n.toLocaleString("en-US");
}

export async function LiveStats() {
  let stats: Stats | null = null;
  try {
    const res = await fetch("https://api.buywhere.ai/v1/stats", {
      next: { revalidate: 300 },
    });
    if (res.ok) stats = (await res.json()) as Stats;
  } catch {
    stats = null;
  }
  if (!stats || !stats.products_indexed) return null;

  const items = [
    { label: "products indexed", value: compact(stats.products_indexed) },
    { label: "merchants", value: compact(stats.merchants_total) },
    { label: "API requests, last 24h", value: compact(stats.requests_24h) },
    { label: "shopping clicks, last 7 days", value: compact(stats.outbound_clicks_7d) },
  ];

  return (
    <section
      role="region"
      aria-label="Live platform statistics"
      className="border-y border-indigo-100 bg-indigo-50/60"
    >
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-10 gap-y-4 px-4 py-6 sm:px-6">
        <span className="inline-flex items-center gap-x-1.5 text-xs font-bold uppercase tracking-wide text-indigo-700">
          <span className="inline-block h-2 w-2 rounded-full bg-green-600" aria-hidden="true"></span>
          Live
        </span>
        {items.map((it) => (
          <div key={it.label} className="text-center">
            <div className="text-2xl font-bold text-gray-900 tabular-nums">{it.value}</div>
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">{it.label}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
