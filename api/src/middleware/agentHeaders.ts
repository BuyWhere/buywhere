import { Request, Response, NextFunction } from 'express';

/**
 * BUY-73471: P2.3 HTTP Headers for AI agent discovery
 *
 * Emits three headers on every API response:
 * - X-Agent-Protocol: advertises MCP + REST endpoints
 * - X-Agent-Card: URL to the agent card
 * - X-LLMs-Txt: URL to the llms.txt documentation
 *
 * Mounted at middleware layer to guarantee coverage of ALL paths including errors.
 */
export function agentHeadersMiddleware(_req: Request, res: Response, next: NextFunction) {
  // X-Agent-Protocol: comma-separated list of available protocol endpoints
  res.set('X-Agent-Protocol', 'MCP https://api.buywhere.ai/mcp, REST https://api.buywhere.ai/v1');

  // X-Agent-Card: URL to the agent card (well-known endpoint)
  res.set('X-Agent-Card', 'https://buywhere.ai/.well-known/agent.json');

  // X-LLMs-Txt: URL to the llms.txt documentation
  res.set('X-LLMs-Txt', 'https://buywhere.ai/llms.txt');

  next();
}
