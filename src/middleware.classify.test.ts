import { describe, it, expect } from "vitest";

// Replicate the classification logic in middleware.ts so we can unit-test it
// without booting Next.js. Keep this in sync with src/middleware.ts.

const BOT_PATTERNS: [RegExp, string][] = [
  [/\bUptimeRobot\b/i, "UptimeRobot"],
  [/\bHeadlessChrome\b/i, "HeadlessChrome"],
  [/\bChrome-Headless\b/i, "HeadlessChrome"],
  [/\bPaperclip-Heartbeat\b/i, "Paperclip"],
  [/\bSketchAudit\b/i, "SketchAudit"],
  [/\bChatGPT-User\//i, "ChatGPT-User"],
  [/\bClaudeBot\//i, "ClaudeBot"],
  [/\bPerplexityBot\//i, "PerplexityBot"],
  [/\bGPTBot\//i, "GPTBot"],
  [/\bGoogle-Extended\//i, "Google-Extended"],
  [/\banthropic-ai\//i, "anthropic-ai"],
  [/\bCCBot\//i, "CCBot"],
  [/\bGooglebot\b/i, "Googlebot"],
  [/\bBingbot\b/i, "Bingbot"],
  [/\bSlurp\b/i, "other_bot"],
  [/\bDuckDuckBot\b/i, "other_bot"],
  [/\bBaiduspider\b/i, "other_bot"],
  [/\bYandexBot\b/i, "other_bot"],
  [/\bAhrefsBot\b/i, "other_bot"],
  [/\bSemrushBot\b/i, "other_bot"],
  [/\bfacebookexternalhit\b/i, "other_bot"],
  [/\bTwitterbot\b/i, "other_bot"],
  [/\bLinkedInBot\b/i, "other_bot"],
  [/\bMJ12bot\b/i, "other_bot"],
  [/\bDotBot\b/i, "other_bot"],
  [/\bBytespider\b/i, "other_bot"],
  [/\bApplebot\b/i, "other_bot"],
  [/\bPetalBot\b/i, "other_bot"],
];

const GENERIC_BOT_RE =
  /(bot|crawl|spider|fetch|scrape|headless|selenium|puppeteer|playwright|curl|wget|python-requests|python-urllib|node-fetch|axios|java|go-http|http\.rb|okhttp|postman|insomnia)/i;

function classifyUa(ua: string): { is_bot: boolean; agent_family: string } {
  if (ua.trim() === "Mozilla/5.0") {
    return { is_bot: true, agent_family: "bare_ua" };
  }
  for (const [re, family] of BOT_PATTERNS) {
    if (re.test(ua)) return { is_bot: true, agent_family: family };
  }
  if (GENERIC_BOT_RE.test(ua)) return { is_bot: true, agent_family: "other_bot" };
  return { is_bot: false, agent_family: "human" };
}

function normalizePathname(pathname: string): string {
  if (pathname !== "/" && pathname.endsWith("/")) {
    return pathname.slice(0, -1);
  }
  return pathname;
}

describe("BUY-70970 bot classification", () => {
  it("tags UptimeRobot as bot", () => {
    const ua = "Mozilla/5.0 (compatible; UptimeRobot/2.0; http://www.uptimerobot.com/)";
    expect(classifyUa(ua)).toEqual({ is_bot: true, agent_family: "UptimeRobot" });
  });

  it("tags HeadlessChrome as bot", () => {
    expect(classifyUa("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/115.0.0.0 Safari/537.36")).toEqual({
      is_bot: true,
      agent_family: "HeadlessChrome",
    });
  });

  it("tags bare Mozilla/5.0 as bot", () => {
    expect(classifyUa("Mozilla/5.0")).toEqual({ is_bot: true, agent_family: "bare_ua" });
  });

  it("tags curl as bot", () => {
    expect(classifyUa("curl/8.5.0")).toEqual({ is_bot: true, agent_family: "other_bot" });
  });

  it("tags python-requests as bot", () => {
    expect(classifyUa("python-requests/2.31.0")).toEqual({ is_bot: true, agent_family: "other_bot" });
  });

  it("tags Paperclip-Heartbeat as bot", () => {
    expect(classifyUa("Paperclip-Heartbeat/1.0")).toEqual({ is_bot: true, agent_family: "Paperclip" });
  });

  it("tags SketchAudit as bot", () => {
    expect(classifyUa("SketchAudit/1.0")).toEqual({ is_bot: true, agent_family: "SketchAudit" });
  });

  it("tags generic *bot* user agents as bot", () => {
    expect(classifyUa("FooBarBot/1.0").is_bot).toBe(true);
  });

  it("keeps real browser as human", () => {
    const ua =
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
    expect(classifyUa(ua)).toEqual({ is_bot: false, agent_family: "human" });
  });

  it("classifies named AI crawlers into their own families", () => {
    expect(classifyUa("Mozilla/5.0 (compatible; ClaudeBot/1.0)")).toEqual({ is_bot: true, agent_family: "ClaudeBot" });
    expect(classifyUa("Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ChatGPT-User/1.0; +https://openai.com/bot)")).toEqual({
      is_bot: true,
      agent_family: "ChatGPT-User",
    });
    expect(classifyUa("Mozilla/5.0 (compatible; PerplexityBot/1.0)")).toEqual({ is_bot: true, agent_family: "PerplexityBot" });
  });
});

describe("BUY-70970 pathname normalization", () => {
  it("strips trailing slash from non-root paths", () => {
    expect(normalizePathname("/developers/")).toBe("/developers");
    expect(normalizePathname("/search/")).toBe("/search");
  });

  it("preserves root path", () => {
    expect(normalizePathname("/")).toBe("/");
  });

  it("preserves paths without trailing slash", () => {
    expect(normalizePathname("/developers")).toBe("/developers");
  });
});

// BUY-71735: P2.3 agent-discovery X-Agent-Auth contract.
// Replicate `withAgentAuthHeader` so we can unit-test without booting Next.js.

interface FakeHeaders {
  get(name: string): string | null;
  set(name: string, value: string): void;
}

class FakeResponse {
  status: number;
  headers = new Map<string, string>();
  constructor(status: number) {
    this.status = status;
  }
  get(name: string): string | null {
    return this.headers.get(name.toLowerCase()) ?? null;
  }
  set(name: string, value: string): void {
    this.headers.set(name.toLowerCase(), value);
  }
}

function fakeWithAgentAuthHeader(response: FakeResponse): FakeResponse {
  const allFive =
    "X-Agent-Protocol, X-Agent-Card, X-LLMs-Txt, X-Agent-Index, X-Agent-Auth";
  if (response.status === 401 || response.status === 403) {
    response.set(
      "X-Agent-Auth",
      "Bearer; register=https://buywhere.ai/api-keys"
    );
  }
  const existing = response.get("Access-Control-Expose-Headers");
  if (existing) {
    if (!existing.includes("X-Agent-Protocol")) {
      response.set("Access-Control-Expose-Headers", `${existing}, ${allFive}`);
    }
  } else {
    response.set("Access-Control-Expose-Headers", allFive);
  }
  return response;
}

describe("withAgentAuthHeader (P2.3)", () => {
  it("adds X-Agent-Auth on 401", () => {
    const r = new FakeResponse(401);
    fakeWithAgentAuthHeader(r);
    expect(r.get("X-Agent-Auth")).toBe(
      "Bearer; register=https://buywhere.ai/api-keys"
    );
  });

  it("adds X-Agent-Auth on 403", () => {
    const r = new FakeResponse(403);
    fakeWithAgentAuthHeader(r);
    expect(r.get("X-Agent-Auth")).toBe(
      "Bearer; register=https://buywhere.ai/api-keys"
    );
  });

  it("does NOT add X-Agent-Auth on 200", () => {
    const r = new FakeResponse(200);
    fakeWithAgentAuthHeader(r);
    expect(r.get("X-Agent-Auth")).toBeNull();
  });

  it("adds Access-Control-Expose-Headers listing all 5 headers when missing", () => {
    const r = new FakeResponse(200);
    fakeWithAgentAuthHeader(r);
    const expose = r.get("Access-Control-Expose-Headers") ?? "";
    expect(expose).toContain("X-Agent-Protocol");
    expect(expose).toContain("X-Agent-Card");
    expect(expose).toContain("X-LLMs-Txt");
    expect(expose).toContain("X-Agent-Index");
    expect(expose).toContain("X-Agent-Auth");
  });

  it("appends to existing Access-Control-Expose-Headers without duplicating", () => {
    const r = new FakeResponse(200);
    r.set("Access-Control-Expose-Headers", "X-Custom-Header");
    fakeWithAgentAuthHeader(r);
    const expose = r.get("Access-Control-Expose-Headers") ?? "";
    expect(expose).toContain("X-Custom-Header");
    // Four X-Agent-* headers (X-LLMs-Txt has no "X-Agent-" prefix).
    expect(expose.match(/X-Agent-/g)?.length).toBe(4);
    expect(expose).toContain("X-LLMs-Txt");
  });
});
