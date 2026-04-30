import { BuyWhereClient } from "../src/index.js";

const apiKey = process.env.BUYWHERE_API_KEY;

if (!apiKey) {
  throw new Error("Set BUYWHERE_API_KEY before running this example.");
}

const query = process.argv[2] ?? "wireless headphones";
const client = new BuyWhereClient(apiKey);

const results = await client.search({
  q: query,
  limit: 5,
  in_stock: true,
});

console.log(`Found ${results.total} products for "${query}"`);
for (const item of results.items) {
  console.log(`${item.id} | ${item.name} | ${item.currency} ${item.price} | ${item.source}`);
}
