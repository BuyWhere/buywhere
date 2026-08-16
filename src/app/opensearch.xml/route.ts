import { unsupportedMetadataRoute } from "@/lib/optional-metadata-routes";

export function GET() {
  return unsupportedMetadataRoute("/opensearch.xml");
}
