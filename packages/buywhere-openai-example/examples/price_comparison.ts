/**
 * Price comparison agent using OpenAI Chat Completions + BuyWhere.
 *
 * Usage:
 *   export BUYWHERE_API_KEY="bw_live_xxx"
 *   npx tsx price_comparison.ts
 */

import OpenAI from "openai";
import { BuyWhereTools, BuyWhereClient } from "@buywhere/openai-tools";

const apiKey = process.env.BUYWHERE_API_KEY;
if (!apiKey) throw new Error("Set BUYWHERE_API_KEY environment variable");

const openai = new OpenAI();
const bw = new BuyWhereClient({ apiKey });

async function main() {
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    {
      role: "system",
      content:
        "You are a price comparison assistant. Use the BuyWhere tools to search for products, compare prices across merchants, and find the best deals. Always present results in a clear table format.",
    },
    {
      role: "user",
      content:
        "Compare prices for the iPhone 16 Pro across different merchants in Singapore. What's the best price?",
    },
  ];

  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages,
    tools: BuyWhereTools,
    tool_choice: "auto",
  });

  const msg = response.choices[0].message;

  if (msg.tool_calls) {
    messages.push(msg);

    for (const toolCall of msg.tool_calls) {
      const result = await bw.dispatch(toolCall);
      messages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: JSON.stringify(result, null, 2),
      });
    }

    const final = await openai.chat.completions.create({
      model: "gpt-4o",
      messages,
    });

    console.log(final.choices[0].message.content);
  } else {
    console.log(msg.content);
  }
}

main().catch(console.error);
