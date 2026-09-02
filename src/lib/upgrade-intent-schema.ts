export const UPGRADE_INTENT_USE_CASES = [
  "personal_project",
  "startup",
  "enterprise",
] as const;

export type UpgradeIntentUseCase = (typeof UPGRADE_INTENT_USE_CASES)[number];

export function isUpgradeIntentUseCase(value: unknown): value is UpgradeIntentUseCase {
  return typeof value === "string" && UPGRADE_INTENT_USE_CASES.includes(value as UpgradeIntentUseCase);
}
