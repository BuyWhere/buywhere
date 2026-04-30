import { BuyWhereClient } from "../src/index.js";

const apiKey = process.env.BUYWHERE_API_KEY;

if (!apiKey) {
  throw new Error("Set BUYWHERE_API_KEY before running this example.");
}

const query = process.argv[2] ?? "Nintendo Switch OLED";
const client = new BuyWhereClient(apiKey);

const search = await client.search({ q: query, limit: 1 });
const product = search.items[0];

if (!product) {
  throw new Error(`No product found for "${query}"`);
}

const comparison = await client.compare({ product_id: product.id });

console.log(`Comparing ${comparison.source_product_name}`);
for (const match of comparison.matches.slice(0, 5)) {
  console.log(`${match.source} | ${match.currency} ${match.price} | score=${match.match_score}`);
}

if (comparison.highlights?.cheapest) {
  console.log(
    `Cheapest: ${comparison.highlights.cheapest.source} ${comparison.highlights.cheapest.currency} ${comparison.highlights.cheapest.price}`
  );
}
