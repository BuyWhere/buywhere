import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getApiBaseUrl } from "@/lib/billing";

export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
  },
};

const API_BASE = getApiBaseUrl();

export default async function ProtectedLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const apiKey = cookies().get("bw_dashboard_key")?.value;

  if (!apiKey) {
    redirect("/login?next=%2Fdashboard");
  }

  try {
    const response = await fetch(`${API_BASE}/v1/developers/me`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      cache: "no-store",
    });

    if (!response.ok) {
      redirect("/login?next=%2Fdashboard");
    }
  } catch {
    redirect("/login?next=%2Fdashboard");
  }

  return children;
}
