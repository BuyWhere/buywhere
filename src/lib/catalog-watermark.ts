/**
 * BUY-79815 — honest catalog freshness watermarks for marketing surfaces.
 *
 * Never stamp wall-clock "today". Never emit a future calendar date.
 * Prefer request-time timestamps (offer lastUpdated) over LAST_REFRESH_ISO.
 */

const UTC_LONG: Intl.DateTimeFormatOptions = {
  dateStyle: "long",
  timeZone: "UTC",
};

export function parseWatermarkMs(
  value: string | number | Date | null | undefined,
  nowMs: number = Date.now(),
): number | null {
  if (value == null || value === "") return null;
  const ts =
    typeof value === "number"
      ? value
      : value instanceof Date
        ? value.getTime()
        : Date.parse(String(value));
  if (!Number.isFinite(ts)) return null;
  if (ts > nowMs) return null;
  return ts;
}

export function formatUtcLongDate(ms: number): string {
  return new Intl.DateTimeFormat("en-US", UTC_LONG).format(new Date(ms));
}

/** Latest non-future timestamp among candidates + optional LAST_REFRESH_ISO. */
export function pickCatalogWatermark(
  timestamps: Array<string | number | Date | null | undefined>,
  envIso: string | undefined = process.env.LAST_REFRESH_ISO,
  nowMs: number = Date.now(),
): number | null {
  let latest: number | null = null;
  for (const t of timestamps) {
    const ms = parseWatermarkMs(t, nowMs);
    if (ms != null && (latest == null || ms > latest)) latest = ms;
  }
  if (latest != null) return latest;
  return parseWatermarkMs(envIso, nowMs);
}

export function compareHeroFreshnessCopy(watermarkMs: number | null): string {
  if (watermarkMs == null) {
    return "Live retailer pricing · cached up to 5 minutes";
  }
  return `Last refreshed: ${formatUtcLongDate(watermarkMs)} · live data cached for 5 minutes`;
}

export function homeTopDealFreshnessCopy(watermarkMs: number | null): string {
  if (watermarkMs == null) return "Top-deal module";
  return `Top-deal module · refreshed ${formatUtcLongDate(watermarkMs)}`;
}
