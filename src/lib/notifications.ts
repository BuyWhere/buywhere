import type { BillingTierName } from "@/lib/billing";

export type NotificationType =
  | "rate_limit_warning"
  | "usage_milestone"
  | "new_feature"
  | "key_rotated"
  | "welcome";

export interface NotificationRecord {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  createdAt: string;
  read: boolean;
}

export interface LocalNotificationContext {
  tier: BillingTierName;
  requestsToday: number;
  dailyLimit: number;
  requestsThisMonth: number;
  rateLimitHits?: number;
  rotationExpiresAt?: string | null;
  now?: number;
}

export function buildLocalDashboardNotifications(
  context: LocalNotificationContext
): NotificationRecord[] {
  const notifications: NotificationRecord[] = [];
  const now = context.now ?? Date.now();
  const usagePercent = context.dailyLimit > 0 ? context.requestsToday / context.dailyLimit : 0;

  if (usagePercent >= 0.8) {
    notifications.push({
      id: `local-rate-limit-${context.requestsToday}-${context.dailyLimit}`,
      type: "rate_limit_warning",
      title: "Rate limit warning",
      body: `You've used ${Math.round(usagePercent * 100)}% of your ${context.tier} tier daily limit today.`,
      createdAt: new Date(now - 1000 * 60 * 6).toISOString(),
      read: false,
    });
  } else if ((context.rateLimitHits ?? 0) > 0) {
    notifications.push({
      id: `local-rate-limit-hit-${context.rateLimitHits}`,
      type: "rate_limit_warning",
      title: "Requests are hitting quota protection",
      body: `${context.rateLimitHits} recent request${context.rateLimitHits === 1 ? "" : "s"} ran into rate limits. Consider slowing retries or upgrading quota.`,
      createdAt: new Date(now - 1000 * 60 * 8).toISOString(),
      read: false,
    });
  }

  const milestones = [100, 500, 1000, 5000, 10000];
  const currentMilestone = [...milestones].reverse().find((milestone) => context.requestsThisMonth >= milestone);
  if (currentMilestone) {
    notifications.push({
      id: `local-milestone-${currentMilestone}`,
      type: "usage_milestone",
      title: "Usage milestone reached",
      body: `You just crossed ${currentMilestone.toLocaleString()} API calls this month.`,
      createdAt: new Date(now - 1000 * 60 * 18).toISOString(),
      read: false,
    });
  }

  if (context.rotationExpiresAt) {
    const expiresAt = new Date(context.rotationExpiresAt).getTime();
    if (!Number.isNaN(expiresAt) && expiresAt > now) {
      const minutesRemaining = Math.max(Math.ceil((expiresAt - now) / 60000), 1);
      notifications.push({
        id: `local-key-rotation-${context.rotationExpiresAt}`,
        type: "key_rotated",
        title: "API key rotated",
        body: `Your API key was rotated. The previous key expires in ${minutesRemaining} minute${minutesRemaining === 1 ? "" : "s"}.`,
        createdAt: new Date(now - 1000 * 60 * 2).toISOString(),
        read: false,
      });
    }
  }

  return notifications;
}

export function mergeNotifications(
  persisted: NotificationRecord[],
  local: NotificationRecord[],
  locallyReadIds: string[]
) {
  const locallyRead = new Set(locallyReadIds);

  return [...persisted, ...local]
    .map((notification) => ({
      ...notification,
      read: notification.read || locallyRead.has(notification.id),
    }))
    .sort((left, right) => {
      return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
    });
}
