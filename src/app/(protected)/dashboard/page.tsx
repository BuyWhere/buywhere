import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";

import DashboardClient from "./DashboardClient";

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
} as const;

type DestinationKey = keyof typeof destinationCopy;

function destinationFromTab(tab?: string | string[]): DestinationKey {
  const value = Array.isArray(tab) ? tab[0] : tab;
  return value === "api-keys" ? "apiKeys" : "dashboard";
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

  return (
    <>
      <main id="main-content" tabIndex={-1} className="sr-only">
        <h1>{copy.h1}</h1>
        <p>{copy.body}</p>
        <Link href={loginHref}>Sign in with API key</Link>
        <Link href="/api-keys">Create API key</Link>
      </main>
      <Suspense fallback={null}>
        <DashboardClient />
      </Suspense>
    </>
  );
}
