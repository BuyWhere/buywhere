const apiKey = process.env.BUYWHERE_API_KEY;

if (!apiKey) {
  throw new Error("Set BUYWHERE_API_KEY before running this example.");
}

const baseUrl = (process.env.BUYWHERE_BASE_URL ?? "https://api.buywhere.ai").replace(/\/$/, "");
const callbackUrl = process.env.BUYWHERE_WEBHOOK_URL;

if (!callbackUrl) {
  throw new Error("Set BUYWHERE_WEBHOOK_URL before running this example.");
}

const response = await fetch(`${baseUrl}/v1/webhooks`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  },
  body: JSON.stringify({
    url: callbackUrl,
    event_types: ["price.updated", "price.dropped"],
    product_ids: [101, 202],
    threshold_percent: 5,
  }),
});

if (!response.ok) {
  throw new Error(`BuyWhere error ${response.status}: ${await response.text()}`);
}

const webhook = await response.json();
console.log(JSON.stringify(webhook, null, 2));
