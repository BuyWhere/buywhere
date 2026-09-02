// BUY-79892: find_best_price geo + high-side outlier guard.
// Catalog rows are often labelled country_code=US while the listing URL is an
// IN/CO/EU retailer and the amount is local currency stored as USD
// (iplanet.one ₹57504, mac-center.com COP 48999). The existing BUY-63229
// guard is a *floor* (15% of median) so these high outliers still win.

const CC_TLD: Record<string, string> = {
  in: 'IN', one: 'IN', co: 'CO', vn: 'VN', th: 'TH', my: 'MY', sg: 'SG', ph: 'PH',
  id: 'ID', jp: 'JP', kr: 'KR', au: 'AU', nz: 'NZ', uk: 'GB', gb: 'GB',
  de: 'DE', fr: 'FR', it: 'IT', es: 'ES', nl: 'NL', br: 'BR', mx: 'MX',
  ca: 'CA', ae: 'AE', sa: 'SA', tw: 'TW', hk: 'HK', cn: 'CN', ch: 'CH',
  tr: 'TR', se: 'SE', no: 'NO', dk: 'DK', pl: 'PL', cz: 'CZ', at: 'AT',
  ie: 'IE', me: 'ME', pt: 'PT', be: 'BE', fi: 'FI', gr: 'GR', hu: 'HU',
  ro: 'RO', bg: 'BG', hr: 'HR', sk: 'SK', si: 'SI', lt: 'LT', lv: 'LV',
  ee: 'EE', lu: 'LU',
};

const GENERIC_TLDS = new Set([
  'com', 'net', 'org', 'io', 'ai', 'app', 'shop', 'store', 'online', 'xyz',
  'info', 'biz',
]);

/** Hosts whose TLD is generic (.com/.one) but the retailer is not US. */
const FOREIGN_HOSTS: Record<string, string> = {
  'iplanet.one': 'IN',
  'mac-center.com': 'CO',
};

const MARKETPLACE_HOSTS: Record<string, string> = {
  'amazon.com': 'US',
  'www.amazon.com': 'US',
  'amazon.com.sg': 'SG',
  'www.amazon.sg': 'SG',
  'amazon.sg': 'SG',
  'amazon.in': 'IN',
  'www.amazon.in': 'IN',
  'bestbuy.com': 'US',
  'www.bestbuy.com': 'US',
  'walmart.com': 'US',
  'www.walmart.com': 'US',
  'target.com': 'US',
  'apple.com': 'US',
  'www.apple.com': 'US',
  'tiki.vn': 'VN',
  'shopee.sg': 'SG',
  'shopee.vn': 'VN',
  'lazada.sg': 'SG',
  'challenger.sg': 'SG',
};

function hostnameFromUrl(url: unknown): string | null {
  if (typeof url !== 'string' || !url) return null;
  try {
    const u = new URL(url.startsWith('http') ? url : `https://${url}`);
    return u.hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

/** Infer merchant country from listing URL host. Null = unknown (keep). */
export function inferHostCountry(url: unknown): string | null {
  const host = hostnameFromUrl(url);
  if (!host) return null;
  if (FOREIGN_HOSTS[host]) return FOREIGN_HOSTS[host];
  if (MARKETPLACE_HOSTS[host]) return MARKETPLACE_HOSTS[host];
  const parts = host.split('.');
  const tld = parts[parts.length - 1];
  if (tld === 'uk' && parts[parts.length - 2] === 'co') return 'GB';
  if (CC_TLD[tld] && tld !== 'com' && tld !== 'net' && tld !== 'org') {
    return CC_TLD[tld];
  }
  // *.co is Colombia unless it's a known generic marketplace
  if (tld === 'co' && parts.length >= 2 && !GENERIC_TLDS.has(parts[parts.length - 2])) {
    return 'CO';
  }
  return null;
}

export function hostMatchesRequestedCountry(url: unknown, requestedCountry: string): boolean {
  const cc = (requestedCountry || '').toUpperCase();
  const inferred = inferHostCountry(url);
  if (!inferred) return true; // unknown host — do not drop (amazon.com etc handled)
  return inferred === cc;
}

/**
 * Drop rows whose URL host is a different country than the request, then
 * drop USD-normalized prices above 4× median (or a device-aware cap).
 * If filtering would empty the set, keep the geo-filtered set (or original).
 */
export function applyFbpGeoAndHighOutlierGuard<T extends Record<string, unknown>>(opts: {
  rows: T[];
  requestedCountry: string;
  rowToUsd: (r: T) => number;
  deviceType?: string | null;
}): { rows: T[]; geoDropped: number; highDropped: number; maxAllowedUsd: number | null } {
  const { rows, requestedCountry, rowToUsd, deviceType } = opts;
  const geoKept = rows.filter((r) => hostMatchesRequestedCountry(r.url ?? r.product_url, requestedCountry));
  const geoDropped = rows.length - geoKept.length;
  const working = geoKept.length > 0 ? geoKept : rows;

  let highDropped = 0;
  let maxAllowedUsd: number | null = null;
  if (working.length >= 3) {
    const sorted = working.map(rowToUsd).filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => a - b);
    if (sorted.length >= 3) {
      const mid = Math.floor(sorted.length / 2);
      const median = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
      // Device phones in USD rarely exceed ~$2500; 4× median catches INR/COP
      // mislabelled as USD (57504 vs median ~1063).
      const deviceCap = deviceType === 'phone' ? 2500 : deviceType === 'laptop' ? 8000 : 15000;
      maxAllowedUsd = Math.min(deviceCap, Math.max(median * 4, median + 500));
      // Phone band: also drop cheap-FX leftovers (CHF/TRY stored as USD) below 40% of median.
      const minPhoneUsd = deviceType === 'phone' ? Math.max(400, median * 0.4) : 0;
      const filtered = working.filter((r) => {
        const usd = rowToUsd(r);
        if (usd > (maxAllowedUsd as number)) return false;
        if (minPhoneUsd > 0 && usd < minPhoneUsd) return false;
        return true;
      });
      if (filtered.length > 0) {
        highDropped = working.length - filtered.length;
        return { rows: filtered, geoDropped, highDropped, maxAllowedUsd };
      }
    }
  } else if (deviceType === 'phone') {
    maxAllowedUsd = 2500;
    const filtered = working.filter((r) => rowToUsd(r) <= 2500);
    highDropped = working.length - filtered.length;
    // Prefer empty over presenting INR/COP-as-USD as a US phone price.
    return { rows: filtered, geoDropped, highDropped, maxAllowedUsd };
  }

  return { rows: working, geoDropped, highDropped, maxAllowedUsd };
}
