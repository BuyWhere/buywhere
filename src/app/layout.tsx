import { Suspense } from "react";
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import Script from "next/script";
import dynamic from "next/dynamic";
import "./globals.css";
import DeveloperSessionBootstrap from "@/components/DeveloperSessionBootstrap";
import SentryErrorBoundary from "@/components/SentryErrorBoundary";
import UpgradeIntentPromptHost from "@/components/UpgradeIntentPromptHost";
import WebVitals from "@/components/WebVitals";
import AnalyticsTracker from "@/components/AnalyticsTracker";
import SkipLinks from "@/components/SkipLinks";
import AgentMarketingBlock from "@/components/AgentMarketingBlock";
import { PosthogProvider } from "@/components/PosthogProvider";
import { CompareProvider } from "@/lib/compare-context";
import { DeveloperAuthProvider } from "@/lib/developer-auth";
import { ThemeProvider } from "@/lib/use-theme";
import { RecentlyViewedProvider } from "@/lib/recently-viewed-context";
import { WishlistProvider } from "@/lib/wishlist-context";

const CompareFloatingBar = dynamic(
  () => import("@/components/ui/CompareFloatingBar").then((mod) => mod.CompareFloatingBar),
  {
    ssr: false,
    loading: () => null,
  }
);

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
  preload: true,
  fallback: ["system-ui", "sans-serif"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://buywhere.ai"),
  title: "BuyWhere — Compare products and prices across 950,000+ stores",
  description:
    "Compare products and prices across 950,000+ retailers in Singapore and the United States. One search, server-rendered tables, and a REST + MCP API for builders.",
  openGraph: {
    type: "website",
    siteName: "BuyWhere",
    title: "BuyWhere — Compare products and prices across 950,000+ stores",
    description:
      "Compare products and prices across 950,000+ retailers in Singapore and the United States. One search, server-rendered tables, and a REST + MCP API for builders.",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "BuyWhere — compare products and prices across 950,000+ stores",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "BuyWhere — Compare products and prices across 950,000+ stores",
    description:
      "Compare products and prices across 950,000+ retailers in Singapore and the United States. One search, server-rendered tables, and a REST + MCP API for builders.",
    images: ["/og-image.png"],
    creator: "@buywhere",
  },
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/favicon.ico", sizes: "48x48" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
  },
  manifest: "/manifest.webmanifest",
  // BUY-67512: Microsoft tile config + color. Only asset routes that
  // resolve from /public with a correct non-HTML MIME type are advertised.
  other: {
    "msapplication-config": "/browserconfig.xml",
    "msapplication-TileColor": "#4F46E5",
  },
};

// Avoid long-lived stale HTML referencing removed hashed static assets after deploy.
// 2026-08-26 (Richmond): ISR regeneration every 5 min turned every crawler visit into a cold catalog search on the
// replica (p95 12–29 s, zero-result timeouts). Hourly is fresh enough for prices on intent/blog/category pages;
// deals/brands/stores keep their own 900 s. Do not lower this again without a replica RAM upgrade.
export const revalidate = 3600;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const clarityProjectId = process.env.NEXT_PUBLIC_CLARITY_PROJECT_ID;
  // BUY-75315: derive the agent-marketing block's example query from the current
  // request pathname so each page renders a keyless GET example relevant to itself.
  // SEO-GATE 4seen-0826 item 1: reading request headers in the root layout marked EVERY ISR route dynamic
  // ("Page changed from static to dynamic at runtime" -> HTTP 500 on all brand/store pages, 03:08-11:30Z).
  // The layout renders a generic agent block; intent pages render their own page-specific block from
  // their config inside SeoLandingPage (no request headers needed).
  const agentSearchQuery = "wireless headphones";
  const agentCountry = "US";
  return (
    <html lang="en" className={inter.variable}>
      <head>
        {/* Safari pinned-tab mask icon (BUY-67512). mask-icon requires a
            monochrome SVG; Next's Metadata API has no field for it. */}
        <link rel="mask-icon" href="/safari-pinned-tab.svg" color="#4F46E5" />
        <link rel="dns-prefetch" href="https://plausible.io" />
        <link rel="preconnect" href="https://plausible.io" />
        <link rel="preconnect" href="https://images.unsplash.com" />
        <link rel="preconnect" href="https://picsum.photos" />
        <Script id="plausible-config" strategy="lazyOnload">{`
          window.plausible=window.plausible||function(){(window.plausible.q=window.plausible.q||[]).push(arguments)};
          window.plausible.init=window.plausible.init||function(i){window.plausible.o=i||{}};
          window.plausible.init();
        `}</Script>
        <Script
          async
          src="https://plausible.io/js/pa-M_CbMUmDsm0yzuqLBDXQO.js"
          strategy="lazyOnload"
        />
        {clarityProjectId && (
          <>
            <link rel="dns-prefetch" href="https://www.clarity.ms" />
            <Script id="ms-clarity" strategy="lazyOnload">{`
              (function(c,l,a,r,i,t,y){
                c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
                t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
                y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
              })(window, document, "clarity", "script", "${clarityProjectId}");
            `}</Script>
          </>
        )}
        {process.env.NEXT_PUBLIC_GTM_ID && (
          <>
            <Script id="gtm-head" strategy="lazyOnload">{`
              window.dataLayer = window.dataLayer || [];
              window.gtag = window.gtag || function(){window.dataLayer.push(arguments)};
              window.gtag('js', new Date());
            `}</Script>
            <Script
              async
              src={`https://www.googletagmanager.com/gtm.js?id=${process.env.NEXT_PUBLIC_GTM_ID}`}
              strategy="lazyOnload"
            />
          </>
        )}
        {process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID && (
          <Script
            async
            src={`https://www.googletagmanager.com/gtag/js?id=${process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID}`}
            strategy="lazyOnload"
          />
        )}
      </head>
      <body role="document" className={`${inter.variable} font-sans antialiased bg-white text-gray-900`}>
        <SkipLinks />
        <SentryErrorBoundary>
          <PosthogProvider>
            <ThemeProvider>
              <DeveloperAuthProvider>
                <DeveloperSessionBootstrap />
                <CompareProvider>
                  <WishlistProvider>
                    <RecentlyViewedProvider>
                      {children}
                      {/* BUY-75315: agent-marketing block, server-rendered on every page */}
                      <AgentMarketingBlock searchQuery={agentSearchQuery} country={agentCountry} />
                      <CompareFloatingBar />
                      <UpgradeIntentPromptHost />
                    </RecentlyViewedProvider>
                  </WishlistProvider>
                </CompareProvider>
              </DeveloperAuthProvider>
            </ThemeProvider>
          </PosthogProvider>
        </SentryErrorBoundary>
        <WebVitals />
        <Suspense fallback={null}><AnalyticsTracker /></Suspense>
      </body>
    </html>
  );
}
