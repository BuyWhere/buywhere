import { NextRequest, NextResponse } from "next/server";
import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import { persistContactInquiry } from "@/lib/contact-inquiries-store";

const SES_REGION = process.env.AWS_REGION ?? "ap-southeast-1";
const FROM_EMAIL = process.env.SES_FROM_EMAIL ?? "noreply@buywhere.ai";
const CONTACT_NOTIFY_EMAIL =
  process.env.CONTACT_NOTIFY_EMAIL
  ?? process.env.SIGNUP_NOTIFY_EMAIL
  ?? "founders@buywhere.ai";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const { companyName, contactName, email, website, message, source } = body as {
    companyName?: string;
    contactName?: string;
    email?: string;
    website?: string;
    message?: string;
    source?: string | null;
  };

  const trimmedCompanyName = companyName?.trim() ?? "";
  const trimmedContactName = contactName?.trim() ?? "";
  const trimmedEmail = email?.trim().toLowerCase() ?? "";
  const trimmedWebsite = website?.trim() ?? "";
  const trimmedMessage = message?.trim() ?? "";
  const trimmedSource = source?.trim() ?? "";

  if (!trimmedCompanyName || !trimmedContactName || !trimmedEmail || !trimmedMessage) {
    return NextResponse.json(
      { error: "Company name, contact name, email, and message are required." },
      { status: 400 }
    );
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
    return NextResponse.json(
      { error: "Invalid email address." },
      { status: 400 }
    );
  }

  if (trimmedWebsite && !/^https?:\/\/.+/i.test(trimmedWebsite)) {
    return NextResponse.json(
      { error: "Website must start with http:// or https://." },
      { status: 400 }
    );
  }

  const createdAt = new Date().toISOString();
  const result = await persistContactInquiry({
    company_name: trimmedCompanyName,
    contact_name: trimmedContactName,
    email: trimmedEmail,
    website: trimmedWebsite || null,
    message: trimmedMessage,
    source: trimmedSource || null,
    created_at: createdAt,
  });

  const ses = new SESClient({ region: SES_REGION });

  try {
    await ses.send(
      new SendEmailCommand({
        Source: FROM_EMAIL,
        Destination: { ToAddresses: [CONTACT_NOTIFY_EMAIL] },
        ReplyToAddresses: [trimmedEmail],
        Message: {
          Subject: {
            Data: `[BuyWhere merchant partnership] ${trimmedCompanyName} - ${trimmedContactName}`,
          },
          Body: {
            Text: {
              Data: `New merchant partnership inquiry

Company: ${trimmedCompanyName}
Contact: ${trimmedContactName}
Email: ${trimmedEmail}
Website: ${trimmedWebsite || "(not provided)"}
Source: ${trimmedSource || "/partnership"}
Stored via: ${result.storage}
Time: ${createdAt}

Message:
${trimmedMessage}
`,
            },
          },
        },
      })
    );
  } catch (error) {
    console.error("Merchant partnership notification failed:", error);
  }

  return NextResponse.json({
    success: true,
    storage: result.storage,
    message: "Thanks, we will be in touch within 2 business days",
  });
}
