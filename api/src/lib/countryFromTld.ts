/** BUY-80151: map ccTLD to ISO country. Unknown generic TLDs stay unknown (caller may default). */
const SUFFIXES: Array<[string, string]> = [
  ['.com.ph', 'PH'],
  ['.ph', 'PH'],
  ['.com.sg', 'SG'],
  ['.sg', 'SG'],
  ['.com.my', 'MY'],
  ['.my', 'MY'],
  ['.co.uk', 'GB'],
  ['.com.au', 'AU'],
  ['.com.tr', 'TR'],
  ['.co.za', 'ZA'],
  ['.co.id', 'ID'],
  ['.id', 'ID'],
  ['.vn', 'VN'],
  ['.th', 'TH'],
  ['.in', 'IN'],
  ['.jp', 'JP'],
  ['.au', 'AU'],
  ['.uk', 'GB'],
  ['.de', 'DE'],
  ['.fr', 'FR'],
  ['.es', 'ES'],
  ['.it', 'IT'],
  ['.ie', 'IE'],
  ['.br', 'BR'],
  ['.mx', 'MX'],
  ['.ca', 'CA'],
  ['.us', 'US'],
];

export function countryFromHostOrDomain(value: string | null | undefined): string | null {
  if (!value) return null;
  const raw = String(value).trim().toLowerCase();
  if (!raw) return null;
  let host = raw;
  try {
    if (raw.includes('://')) host = new URL(raw).hostname;
  } catch {
    host = raw.split('/')[0];
  }
  host = host.replace(/^www\./, '');
  for (const [suffix, cc] of SUFFIXES) {
    if (host.endsWith(suffix) || host === suffix.slice(1)) return cc;
  }
  return null;
}

export function countryOrDefault(value: string | null | undefined, domain?: string | null, fallback = 'SG'): string {
  const explicit = (value || '').trim().toUpperCase();
  if (explicit && explicit !== 'XX') return explicit.slice(0, 2);
  return countryFromHostOrDomain(domain || '') || fallback;
}
