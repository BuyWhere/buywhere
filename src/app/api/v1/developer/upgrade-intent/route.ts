import { NextRequest, NextResponse } from "next/server";
import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import {
  isUpgradeIntentUseCase,
  type UpgradeIntentUseCase,
} from "@/lib/upgrade-intent-schema";
import {
  persistUpgradeIntent,
} from "@/lib/upgrade-intent-store";

const SES_REGION = process.env.AWS_REGION ?? "ap-southeast-1";
const FROM_EMAIL = process.env.SES_FROM_EMAIL ?? "noreply@buywhere.ai";
const FOUNDERS_EMAIL = "founders@buywhere.ai";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const { name, email, company, use_case, source } = body as {
    name?: string;
    email?: string;
    company?: string;
    use_case?: UpgradeIntentUseCase;
    source?: string | null;
  };

  const trimmedName = name?.trim() ?? "";
  const trimmedEmail = email?.trim().toLowerCase() ?? "";
  const trimmedCompany = company?.trim() ?? "";

  if (!trimmedName || !trimmedEmail) {
    return NextResponse.json(
      { error: "Name and work email are required." },
      { status: 400 }
    );
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
    return NextResponse.json(
      { error: "Invalid email address." },
      { status: 400 }
    );
  }

  if (!isUpgradeIntentUseCase(use_case)) {
    return NextResponse.json(
      { error: "Invalid use case." },
      { status: 400 }
    );
  }

  const createdAt = new Date().toISOString();
  const result = await persistUpgradeIntent({
    email: trimmedEmail,
    name: trimmedName,
    company: trimmedCompany || null,
    use_case,
    created_at: createdAt,
  });

  const ses = new SESClient({ region: SES_REGION });

  try {
    await ses.send(
      new SendEmailCommand({
        Source: FROM_EMAIL,
        Destination: { ToAddresses: [FOUNDERS_EMAIL] },
        ReplyToAddresses: [trimmedEmail],
        Message: {
          Subject: { Data: `[BuyWhere Pro intent] ${trimmedName} <${trimmedEmail}>` },
          Body: {
            Text: {
              Data: `New Pro upgrade intent\n\nName: ${trimmedName}\nEmail: ${trimmedEmail}\nCompany: ${trimmedCompany || "(not provided)"}\nUse case: ${use_case}\nSource: ${source || "(unknown)"}\nStored via: ${result.storage}\nTime: ${createdAt}\n`,
            },
          },
        },
      })
    );
  } catch (error) {
    console.error("Upgrade intent notification failed:", error);
  }

  return NextResponse.json({
    success: true,
    storage: result.storage,
  });
}
