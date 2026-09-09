import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

import type { NotificationRecord } from "@/lib/notifications";

interface NotificationStore {
  [developerId: string]: NotificationRecord[];
}

export const NOTIFICATION_STORE_FILE = "/tmp/bw-developer-notifications.json";

export function getDeveloperNotificationId(apiKey: string) {
  return createHash("sha256").update(apiKey).digest("hex");
}

export function readNotificationStore() {
  if (!existsSync(NOTIFICATION_STORE_FILE)) {
    return {} satisfies NotificationStore;
  }

  try {
    return JSON.parse(readFileSync(NOTIFICATION_STORE_FILE, "utf-8")) as NotificationStore;
  } catch {
    return {} satisfies NotificationStore;
  }
}

export function writeNotificationStore(store: NotificationStore) {
  writeFileSync(NOTIFICATION_STORE_FILE, JSON.stringify(store, null, 2));
}

export function createSeedNotifications(): NotificationRecord[] {
  const now = Date.now();

  return [
    {
      id: "welcome-dashboard",
      type: "welcome",
      title: "Welcome to your developer dashboard",
      body: "Track API usage, rotate keys safely, and keep your BuyWhere integration healthy from one place.",
      createdAt: new Date(now - 1000 * 60 * 90).toISOString(),
      read: false,
    },
    {
      id: "feature-price-history",
      type: "new_feature",
      title: "Price history is now available",
      body: "Try /api/v1/products/{id}/price-history to show historical pricing in your product experiences.",
      createdAt: new Date(now - 1000 * 60 * 35).toISOString(),
      read: false,
    },
    {
      id: "feature-quickstart-guides",
      type: "new_feature",
      title: "Quickstart guides are ready for MCP setups",
      body: "Copy the MCP config snippet in the dashboard to connect BuyWhere to local agent workflows faster.",
      createdAt: new Date(now - 1000 * 60 * 10).toISOString(),
      read: false,
    },
  ];
}

export function ensureDeveloperNotifications(apiKey: string) {
  const developerId = getDeveloperNotificationId(apiKey);
  const store = readNotificationStore();

  if (!Array.isArray(store[developerId])) {
    store[developerId] = createSeedNotifications();
    writeNotificationStore(store);
  }

  return {
    developerId,
    notifications: store[developerId],
    store,
  };
}

export function markNotificationsRead(
  apiKey: string,
  payload: { all?: boolean; ids?: string[] }
) {
  const { developerId, store } = ensureDeveloperNotifications(apiKey);
  const existing = store[developerId] ?? [];
  const ids = new Set(payload.ids ?? []);

  const notifications = existing.map((notification) => {
    if (payload.all || ids.has(notification.id)) {
      return {
        ...notification,
        read: true,
      };
    }

    return notification;
  });

  store[developerId] = notifications;
  writeNotificationStore(store);

  return notifications;
}
