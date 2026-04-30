"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

function formatTimeLeft(targetMs: number) {
  const diff = Math.max(targetMs - Date.now(), 0);
  const hours = Math.floor(diff / 3_600_000);
  const minutes = Math.floor((diff % 3_600_000) / 60_000);
  const seconds = Math.floor((diff % 60_000) / 1_000);

  return [hours, minutes, seconds].map((value) => String(value).padStart(2, "0")).join(":");
}

export function DealRefreshCountdown({ refreshAtIso }: { refreshAtIso: string }) {
  const router = useRouter();
  const [timeLeft, setTimeLeft] = useState(() => formatTimeLeft(new Date(refreshAtIso).getTime()));

  useEffect(() => {
    const targetMs = new Date(refreshAtIso).getTime();
    let refreshed = false;

    const tick = () => {
      const remaining = targetMs - Date.now();
      setTimeLeft(formatTimeLeft(targetMs));

      if (remaining <= 0 && !refreshed) {
        refreshed = true;
        router.refresh();
      }
    };

    tick();

    const intervalId = window.setInterval(tick, 1_000);
    const refreshTimeoutId = window.setTimeout(() => {
      if (!refreshed) {
        refreshed = true;
        router.refresh();
      }
    }, Math.max(targetMs - Date.now() + 250, 250));

    return () => {
      window.clearInterval(intervalId);
      window.clearTimeout(refreshTimeoutId);
    };
  }, [refreshAtIso, router]);

  return (
    <span className="font-semibold tabular-nums text-slate-950" aria-live="polite">
      {timeLeft}
    </span>
  );
}
