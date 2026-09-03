// 2026-08-26 (BUY-75497): this route handler is THE robots.txt — it takes precedence over src/app/robots.ts
// (deleted) and the old public/robots.txt (deleted). Keep every rule here. /search and /r/ are crawl-budget
// leaks (4seen 2026-08-26 item 3); /r/ anchors also carry rel="nofollow sponsored".
const robots = `User-agent: *
Allow: /
Disallow: /home/
Disallow: /PAP/
Disallow: /BUY/
Disallow: /v1/
Disallow: /v2/
Disallow: /api/
Disallow: /api-reference/
Disallow: /login
Disallow: /search
Disallow: /r/

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
