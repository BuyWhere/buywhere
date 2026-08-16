import type { Metadata } from "next";
import { toSiteUrl } from "@/lib/site-url";
import OnboardingClient from "./OnboardingClient";

const ONBOARDING_DESCRIPTION =
  "Complete your BuyWhere onboarding to personalize product recommendations, price alerts, and API integration settings.";

function metadataFromStep(stepParam: string | string[] | undefined): Metadata {
  const step = Array.isArray(stepParam) ? stepParam[0] : stepParam;
  const stepNum = parseInt(step ?? "0", 10);

  // Step-specific metadata
  if (!isNaN(stepNum) && stepNum >= 1 && stepNum <= 3) {
    const stepTitles: Record<number, { title: string; description: string }> = {
      1: {
        title: "Select your goals | BuyWhere onboarding",
        description: "Choose what you want to do with BuyWhere — compare prices, track deals, build an agent, or research products.",
      },
      2: {
        title: "Choose product categories | BuyWhere onboarding",
        description: "Select product categories to personalize your BuyWhere experience with relevant deals and recommendations.",
      },
      3: {
        title: "You&apos;re all set | BuyWhere onboarding",
        description: "Your BuyWhere onboarding is complete. Start comparing prices, tracking deals, and building your shopping agent.",
      },
    };

    const meta = stepTitles[stepNum];
    return {
      title: meta.title,
      description: meta.description,
      alternates: {
        canonical: toSiteUrl("/onboarding"),
      },
      robots: {
        index: false,
        follow: true,
      },
      openGraph: {
        title: meta.title,
        description: meta.description,
        url: toSiteUrl(`/onboarding?step=${stepNum}`),
        type: "website",
        siteName: "BuyWhere",
        images: [
          {
            url: "/og-image.png",
            width: 1200,
            height: 630,
            alt: "BuyWhere Onboarding",
          },
        ],
      },
      twitter: {
        card: "summary_large_image",
        title: meta.title,
        description: meta.description,
        images: ["/og-image.png"],
      },
    };
  }

  // Default onboarding metadata
  return {
    title: "Get started | BuyWhere onboarding",
    description: ONBOARDING_DESCRIPTION,
    alternates: {
      canonical: toSiteUrl("/onboarding"),
    },
    robots: {
      index: false,
      follow: true,
    },
    openGraph: {
      title: "Get started | BuyWhere onboarding",
      description: ONBOARDING_DESCRIPTION,
      url: toSiteUrl("/onboarding"),
      type: "website",
      siteName: "BuyWhere",
      images: [
        {
          url: "/og-image.png",
          width: 1200,
          height: 630,
          alt: "BuyWhere Onboarding",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: "Get started | BuyWhere onboarding",
      description: ONBOARDING_DESCRIPTION,
      images: ["/og-image.png"],
    },
  };
}

export function generateMetadata({
  searchParams,
}: {
  searchParams?: { step?: string | string[] };
}): Metadata {
  return metadataFromStep(searchParams?.step);
}

export default function OnboardingPage() {
  return <OnboardingClient />;
}
