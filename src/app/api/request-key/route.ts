import { NextRequest, NextResponse } from "next/server";
import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import { randomBytes } from "crypto";
import { readFileSync, writeFileSync, existsSync } from "fs";

const SES_REGION = process.env.AWS_REGION ?? "ap-southeast-1";
const FROM_EMAIL = process.env.SES_FROM_EMAIL ?? "noreply@buywhere.ai";
const NOTIFY_EMAIL = process.env.SIGNUP_NOTIFY_EMAIL ?? "hello@buywhere.ai";
const SIGNUP_WEBHOOK_URL = process.env.SIGNUP_WEBHOOK_URL ?? "";
const KEYS_FILE = "/tmp/bw-api-keys.json";

function generateKey(): string {
  return "bw_beta_" + randomBytes(20).toString("hex");
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

function saveKey(entry: KeyRecord) {
  const keys = loadKeys();
  keys.push(entry);
  try {
    writeFileSync(KEYS_FILE, JSON.stringify(keys, null, 2));
  } catch {
    // /tmp is ephemeral on Vercel — log and continue
    console.warn("Could not write keys file:", KEYS_FILE);
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { name, email, useCase = "" } = body as {
    name?: string;
    email?: string;
    useCase?: string;
  };

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

  const key = generateKey();
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
    // Email failure is non-fatal — key is still returned in the response
    console.error("SES send failed:", err);
  }

  // Internal notification — lets the team log and follow up personally
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
