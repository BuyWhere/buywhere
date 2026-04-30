import type { Metadata, Viewport } from "next";
import RootLayout from "../layout";

export const viewport: Viewport = {
  themeColor: "#4F46E5",
};

export const metadata: Metadata = {
   metadataBase: new URL("https://buywhere.ai"),
   title: {
     default: "BuyWhere US — Compare Prices from Amazon, Walmart, Target & More",
     template: "%s | BuyWhere US",
   },
   description:
     "Compare product prices across Amazon, Walmart, Target, and other US retailers. Find the best deals and save money on every purchase with BuyWhere.",
   keywords: [
     "price comparison",
     "amazon",
     "walmart",
     "target",
     "buywhere us",
     "compare prices",
     "deal alerts",
     "us shopping",
     "price tracking",
   ],
   authors: [{ name: "BuyWhere" }],
   creator: "BuyWhere",
   publisher: "BuyWhere",
   robots: {
     index: true,
     follow: true,
     googleBot: {
       index: true,
       follow: true,
       "max-video-preview": -1,
       "max-image-preview": "large",
       "max-snippet": -1,
     },
   },
   twitter: {
     card: "summary_large_image",
     title: "BuyWhere US — Compare Prices from Top US Retailers",
     description:
       "Compare product prices across Amazon, Walmart, Target, and other US retailers. Find the best deals with BuyWhere.",
     site: "@buywhere",
     creator: "@buywhere",
   },
   openGraph: {
     type: "website",
     locale: "en_US",
     url: "https://buywhere.ai/us",
     siteName: "BuyWhere US",
     title: "BuyWhere US — Compare Prices from Amazon, Walmart, Target & More",
     description:
       "Compare product prices across Amazon, Walmart, Target, and other US retailers. Find the best deals and save money on every purchase with BuyWhere.",
     images: [
       {
         url: "https://buywhere.ai/assets/img/og-image.png",
         width: 1200,
         height: 630,
         alt: "BuyWhere US - Compare prices across Amazon, Walmart, Target and more",
       },
       {
         url: "https://buywhere.ai/assets/img/og-image.svg",
         width: 1200,
         height: 630,
         alt: "BuyWhere US - Compare prices across Amazon, Walmart, Target and more",
       },
     ],
   },
   alternates: {
     canonical: "https://buywhere.ai/us",
   },
   icons: {
     icon: "/favicon.svg",
     apple: "/apple-touch-icon.svg",
   },
   manifest: "/manifest.json",
 };

export default function USLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return <RootLayout>{children}</RootLayout>;
}