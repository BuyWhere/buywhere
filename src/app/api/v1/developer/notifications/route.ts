import { NextRequest, NextResponse } from "next/server";

import { ensureDeveloperNotifications } from "@/lib/notification-store";

export async function GET(request: NextRequest) {
  const apiKey = request.headers.get("x-api-key");

  if (!apiKey) {
    return NextResponse.json({ error: "API key required" }, { status: 401 });
  }

  const unreadOnly = request.nextUrl.searchParams.get("unread") === "true";
  const { notifications } = ensureDeveloperNotifications(apiKey);
  const filtered = unreadOnly
    ? notifications.filter((notification) => !notification.read)
    : notifications;

  return NextResponse.json({
    notifications: filtered,
    unread_count: notifications.filter((notification) => !notification.read).length,
  });
}
