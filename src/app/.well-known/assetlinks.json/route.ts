import { unsupportedJsonMetadataRoute } from "@/lib/optional-metadata-routes";

export function GET() {
  return unsupportedJsonMetadataRoute("/.well-known/assetlinks.json");
}
