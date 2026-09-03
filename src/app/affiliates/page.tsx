import { permanentRedirect } from "next/navigation";

// BUY-67767: /affiliates is the legacy affiliate-program URL. The partner
// intake funnel now lives at /partnership, so permanently redirect there.
// Target uses no trailing slash to match `trailingSlash: false` (next.config.mjs)
// and avoid a second middleware trailing-slash canonicalisation hop.
export default function AffiliatesPage() {
  permanentRedirect("/partnership");
}
