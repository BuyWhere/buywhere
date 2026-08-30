import { serverCard } from "@/app/.well-known/mcp/server-card.json/route";

export function GET() {
  return Response.json(serverCard, {
    headers: {
      "Cache-Control": "public, max-age=3600",
      "Link": '<https://buywhere.ai/.well-known/mcp/server-card.json>; rel="canonical"; type="application/json"',
    },
  });
}
