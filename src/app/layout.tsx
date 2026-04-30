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
  title: "BuyWhere API — Product Catalog for AI Shopping Agents",
  description:
    "BuyWhere gives AI agents a product catalog layer for live product discovery, comparison, and merchant handoff across the US and Southeast Asia.",
  icons: {
    icon: "/favicon.ico",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={inter.variable}>
      <head>
        <link rel="dns-prefetch" href="https://plausible.io" />
        <link rel="preconnect" href="https://plausible.io" />
        <link rel="preconnect" href="https://images.unsplash.com" />
        <link rel="preconnect" href="https://picsum.photos" />
        <Script id="plausible-config" strategy="afterInteractive">{`
          window.plausible=window.plausible||function(){(window.plausible.q=window.plausible.q||[]).push(arguments)};
          window.plausible.init=window.plausible.init||function(i){window.plausible.o=i||{}};
          window.plausible.init();
        `}</Script>
        <Script
          async
          src="https://plausible.io/js/pa-M_CbMUmDsm0yzuqLBDXQO.js"
          strategy="afterInteractive"
        />
        {process.env.NEXT_PUBLIC_GTM_ID && (
          <>
            <Script id="gtm-head" strategy="afterInteractive">{`
              window.dataLayer = window.dataLayer || [];
              window.gtag = window.gtag || function(){window.dataLayer.push(arguments)};
              window.gtag('js', new Date());
            `}</Script>
            <Script
              async
              src={`https://www.googletagmanager.com/gtm.js?id=${process.env.NEXT_PUBLIC_GTM_ID}`}
              strategy="afterInteractive"
            />
          </>
        )}
        {process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID && (
          <Script
            async
            src={`https://www.googletagmanager.com/gtag/js?id=${process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID}`}
            strategy="afterInteractive"
          />
        )}
      </head>
      <body className={`${inter.variable} font-sans antialiased bg-white text-gray-900`}>
        <SentryErrorBoundary>
          <ThemeProvider>
            <DeveloperAuthProvider>
              <DeveloperSessionBootstrap />
              <CompareProvider>
                <WishlistProvider>
                  <RecentlyViewedProvider>
                    {children}
                    <CompareFloatingBar />
                    <UpgradeIntentPromptHost />
                  </RecentlyViewedProvider>
                </WishlistProvider>
              </CompareProvider>
            </DeveloperAuthProvider>
          </ThemeProvider>
        </SentryErrorBoundary>
        <WebVitals />
        <Suspense fallback={null}><AnalyticsTracker /></Suspense>
      </body>
    </html>
  );
}
