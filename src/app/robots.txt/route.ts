const robots = `User-agent: *
Allow: /
Disallow: /home/
Disallow: /PAP/
Disallow: /BUY/
Disallow: /v1/
Disallow: /v2/
Disallow: /api/
Disallow: /api-reference/

User-agent: GPTBot
Allow: /
User-agent: ClaudeBot
Allow: /
User-agent: PerplexityBot
Allow: /
User-agent: anthropic-ai
Allow: /
User-agent: Google-Extended
Allow: /
User-agent: CCBot
Allow: /

Sitemap: https://buywhere.ai/sitemap.xml
Sitemap: https://buywhere.ai/sitemap-compare.xml

LLMs-Txt: https://buywhere.ai/llms.txt
LLMs-Full-Txt: https://buywhere.ai/.well-known/llms-full.txt
Agent-Card: https://buywhere.ai/.well-known/agent.json
Plugin: https://buywhere.ai/.well-known/ai-plugin.json
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
