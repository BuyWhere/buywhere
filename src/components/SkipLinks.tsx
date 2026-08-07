"use client";

import { useEffect, useState } from "react";

const linkClassName =
  "fixed top-4 z-[200] -translate-y-20 focus:translate-y-0 px-4 py-2 bg-indigo-600 text-white rounded-lg font-medium text-sm shadow-lg transition-transform focus:outline-none focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-indigo-600";

export default function SkipLinks() {
  const [targets, setTargets] = useState({ main: false, navigation: false });

  useEffect(() => {
    setTargets({
      main: Boolean(document.getElementById("main-content")),
      navigation: Boolean(document.getElementById("main-navigation")),
    });
  }, []);

  if (!targets.main && !targets.navigation) {
    return null;
  }

  return (
    <div className="sr-only focus-within:not-sr-only">
      {targets.main && (
        <a href="#main-content" className={`${linkClassName} left-4`}>
          Skip to main content
        </a>
      )}
      {targets.navigation && (
        <a href="#main-navigation" className={`${linkClassName} ${targets.main ? "left-44" : "left-4"}`}>
          Skip to navigation
        </a>
      )}
    </div>
  );
}
