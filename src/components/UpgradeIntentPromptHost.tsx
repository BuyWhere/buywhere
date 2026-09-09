"use client";

import { useEffect, useState } from "react";
import { UpgradeModal } from "@/components/UpgradeModal";
import {
  OPEN_UPGRADE_INTENT_PROMPT_EVENT,
  type UpgradeIntentPromptDetail,
} from "@/lib/upgrade-intent-prompt";

export default function UpgradeIntentPromptHost() {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<UpgradeIntentPromptDetail>({});

  useEffect(() => {
    function handleOpen(event: Event) {
      const customEvent = event as CustomEvent<UpgradeIntentPromptDetail>;
      setDetail(customEvent.detail ?? {});
      setOpen(true);
    }

    window.addEventListener(OPEN_UPGRADE_INTENT_PROMPT_EVENT, handleOpen);
    return () => {
      window.removeEventListener(OPEN_UPGRADE_INTENT_PROMPT_EVENT, handleOpen);
    };
  }, []);

  return (
    <UpgradeModal
      open={open}
      onClose={() => setOpen(false)}
      source={detail.source}
      headline={detail.headline}
      description={detail.description}
    />
  );
}
