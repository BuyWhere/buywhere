"use client";

export interface UpgradeIntentPromptDetail {
  source?: string;
  context?: "pricing" | "rate_limit" | "manual";
  headline?: string;
  description?: string;
}

export const OPEN_UPGRADE_INTENT_PROMPT_EVENT = "buywhere:open-upgrade-intent";

export function openUpgradeIntentPrompt(detail: UpgradeIntentPromptDetail = {}) {
  window.dispatchEvent(
    new CustomEvent<UpgradeIntentPromptDetail>(OPEN_UPGRADE_INTENT_PROMPT_EVENT, {
      detail,
    })
  );
}
