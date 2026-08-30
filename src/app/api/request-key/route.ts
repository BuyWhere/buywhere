import { NextRequest, NextResponse } from "next/server";
import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import { readFileSync, writeFileSync, existsSync } from "fs";

const SES_REGION = process.env.AWS_REGION ?? "ap-southeast-1";
const FROM_EMAIL = process.env.SES_FROM_EMAIL ?? "noreply@buywhere.ai";
const NOTIFY_EMAIL = process.env.SIGNUP_NOTIFY_EMAIL ?? "hello@buywhere.ai";
const SIGNUP_WEBHOOK_URL = process.env.SIGNUP_WEBHOOK_URL ?? "";
const API_BASE_URL = process.env.API_BASE_URL ?? process.env.NEXT_PUBLIC_BUYWHERE_API_URL ?? "https://api.buywhere.ai";
const KEYS_FILE = "/tmp/bw-api-keys.json";

// IP rate limit: 5 requests per hour per IP
// Module-level map survives across requests within the same container process.
const IP_LIMIT = 5;
const IP_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const ipHits = new Map<string, { count: number; windowStart: number }>();

function checkIpRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = ipHits.get(ip);
  if (!entry || now - entry.windowStart > IP_WINDOW_MS) {
    ipHits.set(ip, { count: 1, windowStart: now });
    return true;
  }
  if (entry.count >= IP_LIMIT) return false;
  entry.count++;
  return true;
}

function isApiIssuedKey(key: string): boolean {
  return /^bw_[a-f0-9]{32}$/i.test(key);
}

async function issueApiKey({ name, email, useCase, attribution }: { name: string; email: string; useCase: string; attribution?: Record<string, string> }): Promise<string> {
  const response = await fetch(`${API_BASE_URL}/v1/auth/register`, {
    method: "POST",
    // attribution (2026-08-22): utm_* forwarded in body; referrer forwarded as
    // Referer header so the API's referrer-host fallback works.
    headers: {
      "Content-Type": "application/json",
      ...(attribution?.referrer ? { Referer: attribution.referrer } : {}),
    },
    body: JSON.stringify({
      agent_name: name,
      email,
      use_case: useCase || undefined,
      utm_source: attribution?.utm_source,
      utm_medium: attribution?.utm_medium,
      utm_campaign: attribution?.utm_campaign,
      utm_content: attribution?.utm_content,
      utm_term: attribution?.utm_term,
    }),
    cache: "no-store",
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || typeof data.api_key !== "string" || !isApiIssuedKey(data.api_key)) {
    console.error("API key registration failed:", response.status, data);
    throw new Error("API key registration failed");
  }

  return data.api_key;
}

interface KeyRecord {
  name: string;
  email: string;
  useCase: string;
  key: string;
  created_at: string;
  usage_count: number;
}

function loadKeys(): KeyRecord[] {
  if (!existsSync(KEYS_FILE)) return [];
  try {
    return JSON.parse(readFileSync(KEYS_FILE, "utf-8")) as KeyRecord[];
  } catch {
    return [];
  }
}

function findKeyByEmail(email: string): KeyRecord | undefined {
  return loadKeys().slice().reverse().find(
    (r) => r.email.toLowerCase() === email.toLowerCase() && isApiIssuedKey(r.key)
  );
}

function saveKey(entry: KeyRecord) {
  const keys = loadKeys();
  keys.push(entry);
  try {
    writeFileSync(KEYS_FILE, JSON.stringify(keys, null, 2));
  } catch {
    // /tmp is ephemeral on some runtimes — log and continue
    console.warn("Could not write keys file:", KEYS_FILE);
  }
}

export async function POST(req: NextRequest) {
  // IP rate limiting — prevent burst abuse from directory CTA clicks
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
    req.headers.get("x-real-ip") ??
    "unknown";

  if (!checkIpRateLimit(ip)) {
    return NextResponse.json(
      { error: "Too many requests. Please try again in an hour." },
      { status: 429, headers: { "Retry-After": "3600" } }
    );
  }

  const body = await req.json().catch(() => ({}));
  const { name, email, useCase = "" } = body as {
    name?: string;
    email?: string;
    useCase?: string;
  };
  const attribution: Record<string, string> = {};
  for (const k of ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "referrer"]) {
    const v = (body as Record<string, unknown>)[k];
    if (typeof v === "string" && v) attribution[k] = v.slice(0, 500);
  }

  if (!name || !email) {
    return NextResponse.json(
      { error: "Name and email are required." },
      { status: 400 }
    );
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json(
      { error: "Invalid email address." },
      { status: 400 }
    );
  }

  // Idempotent: return the existing key if this email already registered.
  // This handles both double-clicks from directory CTAs and lost-key recovery.
  const existing = findKeyByEmail(email);
  if (existing) {
    const emailBody = `Hi ${existing.name},

We received another request for your BuyWhere API key. Here is the key we already issued to this address — no new key was created.

API Key:
${existing.key}

Quick start (curl):

  curl "https://api.buywhere.ai/v1/products/search?q=wireless+headphones&limit=5" \\
    -H "Authorization: Bearer ${existing.key}"

Quickstart: https://buywhere.ai/quickstart

If you believe this request was not made by you, contact us at hello@buywhere.ai.

The BuyWhere Team

---
Free during beta. Fair-use limits apply. Questions? hello@buywhere.ai
`;

    const ses = new SESClient({ region: SES_REGION });
    try {
      await ses.send(
        new SendEmailCommand({
          Source: FROM_EMAIL,
          Destination: { ToAddresses: [email] },
          Message: {
            Subject: { Data: "Your existing BuyWhere API key" },
            Body: { Text: { Data: emailBody } },
          },
        })
      );
    } catch (err) {
      console.error("SES send failed (key retrieval):", err);
    }

    return NextResponse.json({ key: existing.key });
  }

  // New registration
  let key: string;
  try {
    key = await issueApiKey({ name, email, useCase , attribution });
  } catch {
    return NextResponse.json(
      { error: "Could not create an API key right now. Please try again." },
      { status: 502 }
    );
  }
  const createdAt = new Date().toISOString();

  saveKey({ name, email, useCase, key, created_at: createdAt, usage_count: 0 });

  const emailBody = `Hi ${name},

Your BuyWhere API key is ready. You're on the free beta plan — no credit card required.

API Key:
${key}

Quick start (curl):

  curl "https://api.buywhere.ai/v1/products/search?q=wireless+headphones&limit=5" \\
    -H "Authorization: Bearer ${key}"

Quickstart: https://buywhere.ai/quickstart

Happy building,
The BuyWhere Team

---
Free during beta. Fair-use limits apply. Questions? hello@buywhere.ai
`;

  const ses = new SESClient({ region: SES_REGION });

  try {
    await ses.send(
      new SendEmailCommand({
        Source: FROM_EMAIL,
        Destination: { ToAddresses: [email] },
        Message: {
          Subject: { Data: "Your BuyWhere API key" },
          Body: { Text: { Data: emailBody } },
        },
      })
    );
  } catch (err) {
    console.error("SES send failed:", err);
  }

  // Internal notification
  try {
    const notifyBody = `New BuyWhere signup

Name:     ${name}
Email:    ${email}
Use case: ${useCase || "(not provided)"}
Key:      ${key}
Time:     ${createdAt}

Reply directly to ${email} for personal follow-up.
`;
    await ses.send(
      new SendEmailCommand({
        Source: FROM_EMAIL,
        Destination: { ToAddresses: [NOTIFY_EMAIL] },
        ReplyToAddresses: [email],
        Message: {
          Subject: { Data: `[BuyWhere signup] ${name} <${email}>` },
          Body: { Text: { Data: notifyBody } },
        },
      })
    );
  } catch (err) {
    console.error("Internal signup notification failed:", err);
  }

  // Persistent signup log — POST to webhook if configured
  if (SIGNUP_WEBHOOK_URL) {
    try {
      await fetch(SIGNUP_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, useCase: useCase || null, key, created_at: createdAt }),
      });
    } catch (err) {
      console.error("Signup webhook failed:", err);
    }
  }

  return NextResponse.json({ key });
}
