import { BROWSERCONFIG_XML, xmlMetadataRoute } from "@/lib/optional-metadata-routes";

export function GET() {
  return xmlMetadataRoute(BROWSERCONFIG_XML);
}
