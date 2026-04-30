import { NextRequest, NextResponse } from "next/server";

import { markNotificationsRead } from "@/lib/notification-store";

interface MarkReadPayload {
  all?: boolean;
  ids?: string[];
}

export async function POST(request: NextRequest) {
  const apiKey = request.headers.get("x-api-key");

  if (!apiKey) {
    return NextResponse.json({ error: "API key required" }, { status: 401 });
  }

  const payload = (await request.json().catch(() => null)) as MarkReadPayload | null;

  if (!payload || (!payload.all && (!Array.isArray(payload.ids) || payload.ids.length === 0))) {
    return NextResponse.json(
      { error: "Provide { all: true } or a non-empty ids array." },
      { status: 400 }
    );
  }

  const notifications = markNotificationsRead(apiKey, payload);

  return NextResponse.json({
    success: true,
    notifications,
    unread_count: notifications.filter((notification) => !notification.read).length,
  });
}
