#!/usr/bin/env node
/**
 * BuyWhere MCP Server
 *
 * STDIO MCP server that proxies to the hosted BuyWhere API at
 * https://api.buywhere.ai/mcp. Set BUYWHERE_API_KEY in your environment.
 *
 * Usage (Claude Desktop / Cursor):
 *   npx -y @buywhere/mcp-server
 *
 * Tools exposed:
 *   search_products   — search catalog by keyword, category, price, region
 *   get_product       — full product details by ID
 *   compare_products  — side-by-side comparison of 2–5 products
 *   get_deals         — current price drops and promotions
 *   list_categories   — available product category taxonomy
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
const API_URL = process.env.BUYWHERE_API_URL ?? "https://api.buywhere.ai/mcp";
const API_KEY = process.env.BUYWHERE_API_KEY ?? "";
if (!API_KEY) {
    process.stderr.write("[buywhere-mcp] Warning: BUYWHERE_API_KEY is not set. Tool calls will fail.\n");
}
async function callHostedMcp(toolName, args) {
    const res = await fetch(API_URL, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${API_KEY}`,
        },
        body: JSON.stringify({
            jsonrpc: "2.0",
            method: "tools/call",
            params: { name: toolName, arguments: args },
            id: 1,
        }),
    });
    if (!res.ok) {
        throw new Error(`BuyWhere API error: ${res.status} ${res.statusText}`);
    }
    const data = (await res.json());
    if (data.error) {
        throw new Error(data.error.message ?? "Unknown BuyWhere API error");
    }
    return data.result?.content ?? data.result ?? data;
}
function toText(result) {
    return typeof result === "string" ? result : JSON.stringify(result, null, 2);
}
const server = new McpServer({
    name: "buywhere",
    version: "0.1.6",
});
// ── search_products ────────────────────────────────────────────────────────────
server.tool("search_products", "Search BuyWhere's normalized product catalog by keyword, category, price range, merchant domain, or region. Returns ranked product records with prices, merchants, and affiliate URLs.", {
    q: z.string().describe("Search query (e.g. 'wireless headphones', 'laptop under 1000')"),
    category: z.string().optional().describe("Filter by category (e.g. 'Electronics', 'Computers', 'Fashion')"),
    country_code: z.string().optional().describe("ISO country code: SG, US, MY, TH, PH, VN, ID (default: SG)"),
    domain: z.string().optional().describe("Filter by merchant domain (e.g. 'lazada.sg', 'shopee.sg')"),
    min_price: z.number().optional().describe("Minimum price in local currency"),
    max_price: z.number().optional().describe("Maximum price in local currency"),
    limit: z.number().optional().describe("Results per page (default: 20, max: 100)"),
    offset: z.number().optional().describe("Pagination offset"),
    compact: z.boolean().optional().describe("Return compact records with fewer fields"),
}, async (args) => {
    const result = await callHostedMcp("search_products", args);
    return { content: [{ type: "text", text: toText(result) }] };
});
// ── get_product ────────────────────────────────────────────────────────────────
server.tool("get_product", "Retrieve full product details from BuyWhere by product ID, including price history, merchant offers, availability, and affiliate URLs.", {
    id: z.string().describe("BuyWhere product ID"),
}, async (args) => {
    const result = await callHostedMcp("get_product", args);
    return { content: [{ type: "text", text: toText(result) }] };
});
// ── compare_products ───────────────────────────────────────────────────────────
server.tool("compare_products", "Side-by-side comparison of 2 to 5 BuyWhere products. Returns a structured comparison of prices, merchants, specifications, and availability across multiple retailers.", {
    ids: z.array(z.string()).describe("Array of 2–5 BuyWhere product IDs to compare"),
}, async (args) => {
    const result = await callHostedMcp("compare_products", args);
    return { content: [{ type: "text", text: toText(result) }] };
});
// ── get_deals ──────────────────────────────────────────────────────────────────
server.tool("get_deals", "Get current deals, price drops, and promotions from BuyWhere's catalog across Singapore and Southeast Asia markets.", {}, async (_args) => {
    const result = await callHostedMcp("get_deals", {});
    return { content: [{ type: "text", text: toText(result) }] };
});
// ── list_categories ────────────────────────────────────────────────────────────
server.tool("list_categories", "List the available product category taxonomy in BuyWhere's catalog. Use this to discover valid category names for search_products filters.", {}, async (_args) => {
    const result = await callHostedMcp("list_categories", {});
    return { content: [{ type: "text", text: toText(result) }] };
});
// ── start ──────────────────────────────────────────────────────────────────────
const transport = new StdioServerTransport();
server.connect(transport).catch((err) => {
    process.stderr.write(`[buywhere-mcp] Fatal: ${String(err)}\n`);
    process.exit(1);
});
//# sourceMappingURL=index.js.map