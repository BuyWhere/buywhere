export type DataFreshness = "fresh" | "recent" | "stale" | "very_stale";

export interface FreshnessColorConfig {
  bg: string;
  text: string;
  dot: string;
}

export function getFreshnessTier(lastUpdated: string): DataFreshness {
  const now = Date.now();
  const updated = new Date(lastUpdated).getTime();
  const hoursSince = (now - updated) / (1000 * 60 * 60);

  if (hoursSince <= 24) return "fresh";
  if (hoursSince <= 72) return "recent";
  if (hoursSince <= 168) return "stale";
  return "very_stale";
}

export function getFreshnessColor(freshness: DataFreshness): FreshnessColorConfig {
  switch (freshness) {
    case "fresh":
      return { bg: "bg-green-50", text: "text-green-700", dot: "bg-green-500" };
    case "recent":
      return { bg: "bg-yellow-50", text: "text-yellow-700", dot: "bg-yellow-500" };
    case "stale":
      return { bg: "bg-orange-50", text: "text-orange-700", dot: "bg-orange-500" };
    case "very_stale":
      return { bg: "bg-red-50", text: "text-red-700", dot: "bg-red-500" };
  }
}

export function getFreshnessLabel(freshness: DataFreshness): string {
  switch (freshness) {
    case "fresh":
      return "Updated recently";
    case "recent":
      return "Updated 1-3 days ago";
    case "stale":
      return "Updated 3-7 days ago";
    case "very_stale":
      return "Data may be outdated";
  }
}