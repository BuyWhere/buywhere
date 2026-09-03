import type { Metadata } from "next";
import Link from "next/link";
import { toSiteUrl } from "@/lib/site-url";

import AccountClient from "./AccountClient";

function buildJsonLd(copy: { h1: string; body: string }, tab?: string) {
  return {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: copy.h1,
    description: copy.body,
    url: toSiteUrl(`/account${tab ? `?tab=${tab}` : ""}`),
    publisher: {
      "@type": "Organization",
      name: "BuyWhere",
      url: "https://buywhere.ai",
    },
  };
}

const destinationCopy = {
  account: {
    title: "Sign in to manage your account | BuyWhere",
    description:
      "Sign in to recover your BuyWhere account settings, notification preferences, security controls, and API access links.",
    h1: "Sign in to manage your account",
    body: "Your account page keeps profile settings, notification preferences, password controls, and API-access recovery in one private workspace.",
  },
  apiKeys: {
    title: "Sign in to manage API keys | BuyWhere",
    description:
      "Sign in to recover API-key management from your BuyWhere account and return to credential controls after authentication.",
    h1: "Sign in to manage API keys",
    body: "This account recovery URL preserves the API-key destination so you can continue to credential management after sign-in.",
  },
  billing: {
    title: "Sign in to manage billing | BuyWhere",
    description:
      "Sign in to recover BuyWhere billing and plan settings for your developer account.",
    h1: "Sign in to manage billing",
    body: "This account recovery URL preserves the billing destination so you can continue to plan and payment settings after sign-in.",
  },
  paymentMethods: {
    title: "Sign in to manage payment methods | BuyWhere",
    description:
      "Sign in to recover BuyWhere payment-method settings for your developer account.",
    h1: "Sign in to manage payment methods",
    body: "This account recovery URL preserves the payment-method destination so you can continue to saved-card and billing settings after sign-in.",
  },
  invoices: {
    title: "Sign in to view invoices | BuyWhere",
    description:
      "Sign in to recover BuyWhere invoice and billing-history settings for your developer account.",
    h1: "Sign in to view invoices",
    body: "This account recovery URL preserves the invoice destination so you can continue to billing history after sign-in.",
  },
  subscription: {
    title: "Sign in to manage subscription | BuyWhere",
    description:
      "Sign in to recover BuyWhere subscription and plan-management settings for your developer account.",
    h1: "Sign in to manage subscription",
    body: "This account recovery URL preserves the subscription destination so you can continue to plan management after sign-in.",
  },
} as const;

type DestinationKey = keyof typeof destinationCopy;

function destinationFromTab(tab?: string | string[]): DestinationKey {
  const value = Array.isArray(tab) ? tab[0] : tab;

  if (value === "api-keys") return "apiKeys";
  if (value === "billing") return "billing";
  if (value === "payment-methods") return "paymentMethods";
  if (value === "invoices") return "invoices";
  if (value === "subscription") return "subscription";
  return "account";
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
  return `/account${query ? `?${query}` : ""}`;
}

export function generateMetadata({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}): Metadata {
  return metadataForDestination(destinationFromTab(searchParams?.tab));
}

export default function AccountPage({
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
      <section aria-label="Account recovery summary" className="sr-only">
        <h1>{copy.h1}</h1>
        <p>{copy.body}</p>
        <Link href={loginHref}>Sign in with API key</Link>
        <Link href="/api-keys">Create API key</Link>
      </section>
      <AccountClient />
    </>
  );
}
