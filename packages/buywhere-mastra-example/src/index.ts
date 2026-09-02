/**
 * BuyWhere + Mastra Integration Example
 *
 * Demonstrates connecting BuyWhere's MCP endpoint to a Mastra AI agent
 * for product search and price comparison across Southeast Asia and the US.
 *
 * Usage:
 *   BUYWHERE_API_KEY=bw_live_... npm start
 *   BUYWHERE_API_KEY=bw_live_... ANTHROPIC_API_KEY=sk-ant-... npm start
 */

import { Mastra } from '@mastra/core';
import { MastraMCPClient } from '@mastra/mcp';

const BUYWHERE_API_KEY = process.env.BUYWHERE_API_KEY;
const MCP_URL = process.env.BUYWHERE_MCP_URL || 'https://api.buywhere.ai/mcp';

if (!BUYWHERE_API_KEY) {
  console.error('Error: BUYWHERE_API_KEY is required.');
  console.error('Get a free key at https://buywhere.ai/api-keys');
  process.exit(1);
}

async function main() {
  console.log('BuyWhere + Mastra Integration Example');
  console.log('=====================================\n');

  // 1. Create BuyWhere MCP client pointing at the HTTP endpoint
  const buywhere = new MastraMCPClient({
    name: 'buywhere',
    server: {
      url: new URL(MCP_URL),
      requestInit: {
        headers: {
          'Authorization': `Bearer ${BUYWHERE_API_KEY}`,
          'User-Agent': 'buywhere-mastra-example/0.1.0',
        },
      },
    },
  });

  // 2. Fetch available tools from BuyWhere MCP
  console.log('Connecting to BuyWhere MCP...');
  const tools = await buywhere.getTools();
  const toolNames = Object.keys(tools);
  console.log(`✓ Connected. Available tools: ${toolNames.join(', ')}\n`);

  // 3. Create a Mastra agent with BuyWhere tools
  //    Falls back gracefully if ANTHROPIC_API_KEY isn't set.
  const llmConfig = process.env.ANTHROPIC_API_KEY
    ? { provider: 'ANTHROPIC' as const, name: 'claude-3-5-sonnet-20241022' }
    : { provider: 'ANTHROPIC' as const, name: 'claude-3-haiku-20240307' };

  const mastra = new Mastra({
    agents: {
      shopper: {
        name: 'BuyWhere Shopping Agent',
        instructions: `You are a helpful shopping assistant powered by BuyWhere.
You help users find products, compare prices across merchants, and discover deals
in Singapore (SG), Malaysia (MY), Thailand (TH), Vietnam (VN), Indonesia (ID),
and the United States (US).

When searching for products:
- Always mention the price and merchant for top results
- Compare at least 2-3 options when relevant
- Note whether a product is in stock
- Use country codes to scope results to the user's region`,
        model: llmConfig,
        tools,
      },
    },
  });

  const agent = mastra.getAgent('shopper');

  // 4. Run example queries
  const queries = [
    'Search for wireless earbuds in Singapore under SGD 100',
    'What is the cheapest laptop available in the US right now?',
    'Compare prices for a standing desk in Malaysia',
  ];

  for (const query of queries) {
    console.log(`> ${query}`);
    console.log('-'.repeat(60));

    try {
      const response = await agent.text(query);
      console.log(response.text);
    } catch (error) {
      if ((error as Error).message?.includes('API key')) {
        console.log('[Skipped: LLM API key not configured — set ANTHROPIC_API_KEY to run full queries]');
        console.log('Tool connection verified. BuyWhere MCP is ready.');
        break;
      }
      throw error;
    }
    console.log();
  }

  // 5. Cleanup
  await buywhere.disconnect?.();
  console.log('Done.');
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
