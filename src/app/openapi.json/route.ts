// Canonical OpenAPI spec lives at https://api.buywhere.ai/openapi.json (FastAPI).
// This route redirects the legacy buywhere.ai alias to the canonical URL so
// marketplace importers always get the up-to-date specification.
export function GET() {
  return Response.redirect("https://api.buywhere.ai/openapi.json", 308);
}
