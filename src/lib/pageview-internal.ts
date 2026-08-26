const INTERNAL_HEALTH_PATHS = new Set([
  "/health",
  "/healthz",
  "/ready",
  "/readyz",
  "/_health",
  "/_ah/health",
]);

const INTERNAL_REFERRER_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "::1",
  "paperclip.localhost",
]);

const INTERNAL_COOKIE_NAMES = [
  "buywhere_internal",
  "bw_internal",
  "paperclip_internal",
];

const INTERNAL_COOKIE_VALUES = new Set(["1", "true", "yes", "internal"]);

function isPrivateOrLoopbackIp(ip: string | null): boolean {
  if (!ip) return false;

  const normalized = ip.trim().toLowerCase();
  if (!normalized) return false;
  if (normalized === "::1" || normalized === "localhost") return true;

  const ipv4 = normalized.startsWith("::ffff:")
    ? normalized.slice("::ffff:".length)
    : normalized;
  const parts = ipv4.split(".").map((part) => Number.parseInt(part, 10));
  if (parts.length === 4 && parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)) {
    const [a, b] = parts;
    return (
      a === 10 ||
      a === 127 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254)
    );
  }

  return normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe80:");
}

function hasInternalCookie(cookieHeader: string | null): boolean {
  if (!cookieHeader) return false;

  return cookieHeader.split(";").some((cookie) => {
    const [rawName, ...rawValueParts] = cookie.trim().split("=");
    const name = rawName?.trim();
    if (!name || !INTERNAL_COOKIE_NAMES.includes(name)) return false;
    try {
      const value = decodeURIComponent(rawValueParts.join("=").trim()).toLowerCase();
      return INTERNAL_COOKIE_VALUES.has(value);
    } catch {
      return false;
    }
  });
}

function hasInternalReferrer(referrer: string | null): boolean {
  if (!referrer) return false;

  try {
    const host = new URL(referrer).hostname.toLowerCase();
    return INTERNAL_REFERRER_HOSTS.has(host) || host.endsWith(".localhost");
  } catch {
    return false;
  }
}

export function isInternalPageview(input: {
  pathname: string;
  isBot: boolean;
  ip: string | null;
  cookieHeader: string | null;
  referrer: string | null;
}): boolean {
  if (INTERNAL_HEALTH_PATHS.has(input.pathname)) return true;
  if (input.isBot) return true;
  if (isPrivateOrLoopbackIp(input.ip)) return true;
  if (hasInternalCookie(input.cookieHeader)) return true;
  if (hasInternalReferrer(input.referrer)) return true;
  return false;
}
