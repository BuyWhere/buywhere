import { NextRequest, NextResponse } from "next/server";

import { updateDeveloperPreferences, type NotificationPreferences, type EmailAlertFrequency } from "./store";

const VALID_FREQUENCIES: EmailAlertFrequency[] = ["instant", "daily", "off"];

export async function PUT(request: NextRequest) {
  const apiKey = request.headers.get("x-api-key") ?? request.cookies.get("bw_dashboard_key")?.value;

  if (!apiKey) {
    return NextResponse.json({ error: "API key required" }, { status: 401 });
  }

  try {
    const body = await request.json() as Partial<NotificationPreferences>;

    const emailAlertFrequency = VALID_FREQUENCIES.includes(body.email_alert_frequency as EmailAlertFrequency)
      ? (body.email_alert_frequency as EmailAlertFrequency)
      : "instant";

    const preferences: NotificationPreferences = {
      email_alert_frequency: emailAlertFrequency,
      deal_digest: typeof body.deal_digest === "boolean" ? body.deal_digest : false,
    };

    const updated = updateDeveloperPreferences(apiKey, preferences);

    return NextResponse.json({ notification_preferences: updated });
  } catch {
    return NextResponse.json(
      { error: "Failed to update preferences" },
      { status: 500 }
    );
  }
}