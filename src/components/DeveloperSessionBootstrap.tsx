"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

export default function DeveloperSessionBootstrap() {
  const pathname = usePathname();

  useEffect(() => {
    const apiKey = window.localStorage.getItem("bw_api_key");

    if (!apiKey) {
      return;
    }

    void fetch("/api/dashboard/session", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
      },
    }).catch(() => {
      // Session renewal is best-effort on public pages.
    });
  }, [pathname]);

  return null;
}
