import { APPLE_APP_SITE_ASSOCIATION, jsonMetadataRoute } from "@/lib/optional-metadata-routes";

export function GET() {
  return jsonMetadataRoute(APPLE_APP_SITE_ASSOCIATION, "application/json");
}
