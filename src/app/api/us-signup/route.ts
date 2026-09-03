import { NextRequest, NextResponse } from "next/server";
import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import { readFileSync, writeFileSync, existsSync, appendFileSync } from "fs";

const SES_REGION = process.env.AWS_REGION ?? "ap-southeast-1";
const FROM_EMAIL = process.env.SES_FROM_EMAIL ?? "noreply@buywhere.ai";
const NOTIFY_EMAIL = process.env.SIGNUP_NOTIFY_EMAIL ?? "hello@buywhere.ai";
const SIGNUP_WEBHOOK_URL = process.env.US_SIGNUP_WEBHOOK_URL ?? "";
const US_SIGNUPS_FILE = "/tmp/bw-us-signups.json";

interface USSignupRecord {
  email: string;
  created_at: string;
  source?: string;
}

function loadSignups(): USSignupRecord[] {
  if (!existsSync(US_SIGNUPS_FILE)) return [];
  try {
    return JSON.parse(readFileSync(US_SIGNUPS_FILE, "utf-8")) as USSignupRecord[];
  } catch {
    return [];
  }
}

function saveSignup(entry: USSignupRecord) {
  const signups = loadSignups();
  const existing = signups.find(s => s.email === entry.email);
  if (existing) return;
  signups.push(entry);
  try {
    writeFileSync(US_SIGNUPS_FILE, JSON.stringify(signups, null, 2));
  } catch {
    console.warn("Could not write signups file:", US_SIGNUPS_FILE);
  }
}

function logToCsv(entry: USSignupRecord) {
  const csvLine = `${entry.email},${entry.created_at},${entry.source || ""}\n`;
  try {
    appendFileSync("/tmp/bw-us-signups.csv", csvLine);
  } catch {
    console.warn("Could not append to CSV log");
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { email, source } = body as {
    email?: string;
    source?: string;
  };

  if (!email) {
    return NextResponse.json(
      { error: "Email is required." },
      { status: 400 }
    );
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json(
      { error: "Invalid email address." },
      { status: 400 }
    );
  }

  const createdAt = new Date().toISOString();

  saveSignup({ email, created_at: createdAt, source });
  logToCsv({ email, created_at: createdAt, source });

  const confirmBody = `Hi there,

Thanks for joining the BuyWhere US launch list!

We're building the best way to compare prices across Amazon, Walmart, Target, and more — coming April 23.

We'll notify you the moment we go live.

Happy saving,
The BuyWhere Team

---
Questions? hello@buywhere.ai
`;

  const ses = new SESClient({ region: SES_REGION });

  try {
    await ses.send(
      new SendEmailCommand({
        Source: FROM_EMAIL,
        Destination: { ToAddresses: [email] },
        Message: {
          Subject: { Data: "You're on the list! 🎉 BuyWhere US is coming" },
          Body: { Text: { Data: confirmBody } },
        },
      })
    );
  } catch (err) {
    console.error("SES confirmation send failed:", err);
  }

  try {
    const notifyBody = `New US Launch Signup

Email: ${email}
Time: ${createdAt}
Source: ${source || "(direct)"}

Reply directly to ${email} for personal follow-up.
`;
    await ses.send(
      new SendEmailCommand({
        Source: FROM_EMAIL,
        Destination: { ToAddresses: [NOTIFY_EMAIL] },
        ReplyToAddresses: [email],
        Message: {
          Subject: { Data: `[BuyWhere US signup] ${email}` },
          Body: { Text: { Data: notifyBody } },
        },
      })
    );
  } catch (err) {
    console.error("Internal signup notification failed:", err);
  }

  if (SIGNUP_WEBHOOK_URL) {
    try {
      await fetch(SIGNUP_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, created_at: createdAt, source: source || null }),
      });
    } catch (err) {
      console.error("Signup webhook failed:", err);
    }
  }

  return NextResponse.json({ success: true });
}