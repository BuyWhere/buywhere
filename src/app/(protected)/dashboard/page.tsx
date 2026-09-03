import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { toSiteUrl } from "@/lib/site-url";

import DashboardClient from "./DashboardClient";

function buildJsonLd(copy: { h1: string; body: string }, tab?: string) {
  return {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: copy.h1,
    description: copy.body,
    url: toSiteUrl(`/dashboard${tab ? `?tab=${tab}` : ""}`),
    publisher: {
      "@type": "Organization",
      name: "BuyWhere",
      url: "https://buywhere.ai",
    },
  };
}

const destinationCopy = {
  dashboard: {
    title: "Sign in to open your developer dashboard | BuyWhere",
    description:
      "Sign in to recover your BuyWhere developer dashboard, API key controls, usage metrics, and integration resources.",
    h1: "Sign in to open your developer dashboard",
    body: "Your dashboard keeps API key management, quota usage, notifications, and integration resources in one private workspace.",
  },
  apiKeys: {
    title: "Sign in to manage API keys | BuyWhere",
    description:
      "Sign in to recover the BuyWhere dashboard API-key tab, rotate credentials, and review usage for your developer account.",
    h1: "Sign in to manage API keys",
    body: "This recovery URL will return you to the API-key tab after sign-in so you can copy, rotate, or troubleshoot credentials.",
  },
  billing: {
    title: "Sign in to manage dashboard billing | BuyWhere",
    description:
      "Sign in to recover the BuyWhere dashboard billing tab, plan status, and quota details for your developer account.",
    h1: "Sign in to manage dashboard billing",
    body: "This recovery URL will return you to the billing tab after sign-in so you can review plan status, quota, and subscription next steps.",
  },
} as const;

type DestinationKey = keyof typeof destinationCopy;

function destinationFromTab(tab?: string | string[]): DestinationKey {
  const value = Array.isArray(tab) ? tab[0] : tab;

  if (value === "api-keys") return "apiKeys";
  if (value === "billing") return "billing";
  return "dashboard";
}

function metadataForDestination(destination: DestinationKey): Metadata {
  const copy = destinationCopy[destination];

  return {
    title: copy.title,
    description: copy.description,
    robots: {
      index: false,
      follow: false,
    },
    openGraph: {
      title: copy.title,
      description: copy.description,
      siteName: "BuyWhere",
      type: "website",
      images: [
        {
          url: "/og-image.png",
          width: 1200,
          height: 630,
          alt: copy.h1,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: copy.title,
      description: copy.description,
      images: ["/og-image.png"],
    },
  };
}

function buildReturnPath(searchParams?: Record<string, string | string[] | undefined>) {
  const params = new URLSearchParams();

  for (const [key, rawValue] of Object.entries(searchParams ?? {})) {
    const values = Array.isArray(rawValue) ? rawValue : [rawValue];
    for (const value of values) {
      if (typeof value === "string") {
        params.append(key, value);
      }
    }
  }

  const query = params.toString();
  return `/dashboard${query ? `?${query}` : ""}`;
}

export function generateMetadata({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}): Metadata {
  return metadataForDestination(destinationFromTab(searchParams?.tab));
}

export default function DashboardPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const destination = destinationFromTab(searchParams?.tab);
  const copy = destinationCopy[destination];
  const returnPath = buildReturnPath(searchParams);
  const loginHref = `/login?next=${encodeURIComponent(returnPath)}`;
  const tab = Array.isArray(searchParams?.tab) ? searchParams?.tab[0] : searchParams?.tab;

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(buildJsonLd(copy, tab)) }}
      />
      <section aria-label="Dashboard recovery summary" className="sr-only">
        <h1>{copy.h1}</h1>
        <p>{copy.body}</p>
        <Link href={loginHref}>Sign in with API key</Link>
        <Link href="/api-keys">Create API key</Link>
      </section>
      <Suspense fallback={null}>
        <DashboardClient />
      </Suspense>
    </>
  );
}
