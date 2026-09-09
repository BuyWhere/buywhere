function decodeSlugSegment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function extractLegacyProductQuery(slug: string): string {
  const decoded = decodeSlugSegment(slug)
    .trim()
    .replace(/\/+$/g, "")
    .toLowerCase();

  if (!decoded) {
    return "";
  }

  const segments = decoded.split("-").filter(Boolean);
  if (segments.length === 0) {
    return "";
  }

  const tail = segments[segments.length - 1] ?? "";
  const suffixLooksLikeId =
    /^\d+$/.test(tail) ||
    /^[a-f0-9]{8,}$/i.test(tail) ||
    /^[a-z]{2,}\d[\da-z-]*$/i.test(tail);

  const querySegments =
    suffixLooksLikeId && segments.length > 1 ? segments.slice(0, -1) : segments;

  return querySegments.join(" ").trim();
}

export function buildUSLegacyProductRedirect(slug: string): string {
  const query = extractLegacyProductQuery(slug);
  if (!query) {
    return "/compare/us/";
  }

  return `/compare/us/?q=${encodeURIComponent(query)}`;
}

export function buildSGLegacyProductRedirect(slug: string): string {
  const query = extractLegacyProductQuery(slug);
  if (!query) {
    return "/search?country=SG";
  }

  return `/search?q=${encodeURIComponent(query)}&country=SG`;
}
