"use client";

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";
import { clearDeveloperSession } from "@/lib/developer-session";

interface DeveloperAuthProfile {
  id: string;
  email: string;
  plan: string;
  created_at: string;
}

type DeveloperAuthStatus = "loading" | "authenticated" | "anonymous";

interface DeveloperAuthContextValue {
  developer: DeveloperAuthProfile | null;
  status: DeveloperAuthStatus;
  isAuthenticated: boolean;
  signOut: () => Promise<void>;
}

const DeveloperAuthContext = createContext<DeveloperAuthContextValue | undefined>(undefined);

export function DeveloperAuthProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [developer, setDeveloper] = useState<DeveloperAuthProfile | null>(null);
  const [status, setStatus] = useState<DeveloperAuthStatus>("loading");
  const requestIdRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    const apiKey = window.localStorage.getItem("bw_api_key");
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;

    if (!apiKey) {
      setDeveloper(null);
      setStatus("anonymous");
      return;
    }

    setStatus((current) => (current === "authenticated" ? current : "loading"));

    // Fetch developer profile on the client side
    fetch("/api/dashboard/account", {
      headers: { "x-api-key": apiKey },
      cache: "no-store",
    })
      .then(async (response) => {
        if (cancelled || requestIdRef.current !== requestId) {
          return;
        }

        if (!response.ok) {
          if (response.status === 401 || response.status === 403) {
            throw new Error("Unauthorized");
          }
          throw new Error("Failed to load developer profile");
        }

        const payload = await response.json() as {
          developer: DeveloperAuthProfile;
        };

        setDeveloper(payload.developer);
        setStatus("authenticated");
      })
      .catch(async (error: Error) => {
        if (cancelled || requestIdRef.current !== requestId) {
          return;
        }

        if (error.message === "Unauthorized") {
          setDeveloper(null);
          setStatus("anonymous");

          try {
            await clearDeveloperSession();
          } catch {
            // Ignore best-effort cleanup errors and keep the UI signed out.
          }

          return;
        }

        setStatus((current) => (current === "authenticated" ? current : "anonymous"));
      });

    return () => {
      cancelled = true;
    };
  }, [pathname]);

  async function signOut() {
    setDeveloper(null);
    setStatus("anonymous");

    try {
      await clearDeveloperSession();
    } catch {
      // Keep local UI state signed out even if cookie cleanup fails.
    }
  }

  return (
    <DeveloperAuthContext.Provider
      value={{
        developer,
        status,
        isAuthenticated: status === "authenticated" && Boolean(developer),
        signOut,
      }}
    >
      {children}
    </DeveloperAuthContext.Provider>
  );
}

export function useDeveloperAuth() {
  const context = useContext(DeveloperAuthContext);

  if (!context) {
    throw new Error("useDeveloperAuth must be used within a DeveloperAuthProvider");
  }

  return context;
}