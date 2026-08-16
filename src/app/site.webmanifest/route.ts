import { SITE_WEB_MANIFEST, jsonMetadataRoute } from "@/lib/optional-metadata-routes";

export function GET() {
  return jsonMetadataRoute(SITE_WEB_MANIFEST, "application/manifest+json");
}
