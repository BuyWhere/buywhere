const robots = `User-agent: *
Allow: /

Sitemap: https://buywhere.ai/sitemap.xml
Sitemap: https://buywhere.ai/sitemap-compare.xml

Content-Signal: ai-train=no, search=yes, ai-input=yes
`;

export function GET() {
  return new Response(robots, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
      "Content-Signal": "ai-train=no, search=yes, ai-input=yes",
    },
  });
}
