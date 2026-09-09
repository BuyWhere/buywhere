import type { Metadata } from "next";
import { toSiteUrl } from "@/lib/site-url";

type BuildPageMetadataInput = {
  title: string;
  description: string;
  path: string;
  ogType?: "website" | "article";
  image?: {
    url: string;
    width?: number;
    height?: number;
    alt?: string;
  };
};

export function buildPageMetadata(input: BuildPageMetadataInput): Metadata {
  const canonical = toSiteUrl(input.path);
  const image = input.image ?? {
    url: "/og-image.png",
    width: 1200,
    height: 630,
    alt: input.title,
  };

  return {
    title: input.title,
    description: input.description,
    alternates: {
      canonical,
    },
    robots: {
      index: true,
      follow: true,
    },
    openGraph: {
      title: input.title,
      description: input.description,
      url: canonical,
      type: input.ogType ?? "website",
      siteName: "BuyWhere",
      images: [
        {
          url: image.url,
          width: image.width ?? 1200,
          height: image.height ?? 630,
          alt: image.alt ?? input.title,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: input.title,
      description: input.description,
      images: [image.url],
    },
  };
}
