// BUY-67074 — validation for the incoming `Next-Router-State-Tree` header.
//
// Next.js 14.2.35 throws (HTTP 500) while rendering a dynamically rendered App
// Router route when this header is not a canonical tree Next produced itself.
// Next parses the header and walks it against the real route tree; a malformed
// tree, or a tree whose `__PAGE__` segment carries a populated searchParams
// object instead of the canonical `__PAGE__?{"q":"…"}` string form, blows up
// inside the renderer before any userland code or `error.tsx` boundary can
// catch it.
//
// Statically cached routes (/about, /blog, the SEO slug rewrites, …) never
// showed the fault because they are served from the full-route cache without
// re-rendering. Only the two dynamic routes — /search and /compare — render
// per request, which is why the bug presents as "/search and /compare 500".
//
// The header is purely a client-side navigation optimisation, so middleware
// can strip it when it is not a shape Next can safely consume: Next then
// renders the full tree, exactly as it does for a cold navigation. Canonical
// trees must pass through untouched so real client navigations keep their
// partial-render fast path.

/**
 * A FlightRouterState node is
 *   [segment, parallelRoutes, url?, refresh?, isRootLayout?]
 * where `segment` is a string ("", "search", `__PAGE__?{…}`) or a dynamic-route
 * triple [param, value, type], and `parallelRoutes` maps slot name -> child
 * node.
 */
function isFlightRouterState(node: unknown): boolean {
  if (!Array.isArray(node) || node.length < 2) return false;

  const segment: unknown = node[0];
  const parallelRoutes: unknown = node[1];

  const segmentOk =
    typeof segment === "string" ||
    (Array.isArray(segment) &&
      segment.length === 3 &&
      segment.every((part) => typeof part === "string"));
  if (!segmentOk) return false;

  if (
    typeof parallelRoutes !== "object" ||
    parallelRoutes === null ||
    Array.isArray(parallelRoutes)
  ) {
    return false;
  }

  const slots = parallelRoutes as Record<string, unknown>;

  // The shape that crashes the renderer: a `__PAGE__` segment must never carry
  // a populated searchParams object in its parallel-routes slot. Canonical Next
  // encodes search params into the segment string itself (`__PAGE__?{"q":…}`)
  // and leaves this slot empty.
  if (typeof segment === "string" && segment.startsWith("__PAGE__")) {
    return Object.keys(slots).length === 0;
  }

  return Object.values(slots).every(isFlightRouterState);
}

/**
 * Returns true when `rawHeader` is a router state tree Next.js can safely
 * consume. Callers should strip the header when this returns false.
 */
export function isCanonicalRouterStateTree(rawHeader: string): boolean {
  let tree: unknown;
  try {
    tree = JSON.parse(decodeURIComponent(rawHeader));
  } catch {
    // The header is normally percent-encoded, but tolerate a raw JSON value
    // before deciding it is malformed.
    try {
      tree = JSON.parse(rawHeader);
    } catch {
      return false;
    }
  }

  return isFlightRouterState(tree);
}
