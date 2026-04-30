import { BuyWhereClient } from "../src/index.js";

const apiKey = process.env.BUYWHERE_API_KEY;

if (!apiKey) {
  throw new Error("Set BUYWHERE_API_KEY before running this example.");
}

const baseUrl = (process.env.BUYWHERE_BASE_URL ?? "https://api.buywhere.ai").replace(/\/$/, "");
const query = process.argv[2] ?? "iPhone 15";
const limit = Number(process.argv[3] ?? "30");
const client = new BuyWhereClient(apiKey, { baseUrl });

const search = await client.search({ q: query, limit: 1 });
const product = search.items[0];

if (!product) {
  throw new Error(`No product found for "${query}"`);
}

// Raw HTTP fallback until the TypeScript SDK exposes a dedicated getPriceHistory helper.
const response = await fetch(`${baseUrl}/v1/products/${product.id}/price-history?limit=${limit}`, {
  headers: {
    Authorization: `Bearer ${apiKey}`,
    Accept: "application/json",
  },
});

if (!response.ok) {
  throw new Error(`BuyWhere error ${response.status}: ${await response.text()}`);
}

const history = await response.json();
console.log(JSON.stringify(history, null, 2));
