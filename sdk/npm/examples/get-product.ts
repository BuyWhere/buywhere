import { BuyWhereClient } from "../src/index.js";

const apiKey = process.env.BUYWHERE_API_KEY;

if (!apiKey) {
  throw new Error("Set BUYWHERE_API_KEY before running this example.");
}

const productId = Number(process.argv[2] ?? "78234");

if (Number.isNaN(productId)) {
  throw new Error("Pass a numeric product ID.");
}

const client = new BuyWhereClient(apiKey);
const product = await client.getProduct(productId);

console.log(JSON.stringify({
  id: product.id,
  name: product.name,
  price: product.price,
  currency: product.currency,
  source: product.source,
  buy_url: product.buy_url,
  affiliate_url: product.affiliate_url,
}, null, 2));
