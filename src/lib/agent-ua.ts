export type AgentFamily =
  | "ChatGPT-User"
  | "ClaudeBot"
  | "PerplexityBot"
  | "GPTBot"
  | "Google-Extended"
  | "anthropic-ai"
  | "CCBot"
  | "Googlebot"
  | "Bingbot"
  | "other_bot"
  | "human";

export interface UaClassification {
  is_bot: boolean;
  agent_family: AgentFamily;
}

const BOT_PATTERNS: [RegExp, AgentFamily][] = [
  [/\bChatGPT-User\//i, "ChatGPT-User"],
  [/\bClaudeBot\//i, "ClaudeBot"],
  [/\bPerplexityBot\//i, "PerplexityBot"],
  [/\bGPTBot\//i, "GPTBot"],
  [/\bGoogle-Extended\//i, "Google-Extended"],
  [/\banthropic-ai\//i, "anthropic-ai"],
  [/\bCCBot\//i, "CCBot"],
  [/\bGooglebot\//i, "Googlebot"],
  [/\bBingbot\//i, "Bingbot"],
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

const GENERIC_BOT_RE = /\b(bot|crawl|spider|fetch|scrape|headless|selenium|puppeteer|playwright|curl|wget|python-requests|node-fetch|axios|http\.rb|go-http)\b/i;

export function classifyAgent(ua: string): UaClassification {
  if (!ua) {
    return { is_bot: false, agent_family: "human" };
  }

  for (const [re, family] of BOT_PATTERNS) {
    if (re.test(ua)) {
      return { is_bot: true, agent_family: family };
    }
  }

  if (GENERIC_BOT_RE.test(ua)) {
    return { is_bot: true, agent_family: "other_bot" };
  }

  return { is_bot: false, agent_family: "human" };
}
