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

async function loadDeveloperProfile(apiKey: string) {
  const response = await fetch("/api/dashboard/account", {
    headers: { "x-api-key": apiKey },
    cache: "no-store",
  });

  if (!response.ok) {
    const error = new Error("Failed to load developer profile") as Error & {
      status?: number;
    };
    error.status = response.status;
    throw error;
  }

  const payload = await response.json() as {
    developer: DeveloperAuthProfile;
  };

  return payload.developer;
}

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

    void loadDeveloperProfile(apiKey)
      .then((nextDeveloper) => {
        if (cancelled || requestIdRef.current !== requestId) {
          return;
        }

        setDeveloper(nextDeveloper);
        setStatus("authenticated");
      })
      .catch(async (error: Error & { status?: number }) => {
        if (cancelled || requestIdRef.current !== requestId) {
          return;
        }

        if (error.status === 401 || error.status === 403) {
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
