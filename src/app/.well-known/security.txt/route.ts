import { SECURITY_TXT, textMetadataRoute } from "@/lib/optional-metadata-routes";

export function GET() {
  return textMetadataRoute(SECURITY_TXT);
}
