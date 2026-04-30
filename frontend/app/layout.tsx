import type { Metadata } from 'next';
import './globals.css';
import {
  getRegion,
  getRegionConfig,
  regionTitle,
  regionKeywords,
} from '@/lib/regionMetadata';

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'https://buywhere.ai';
const region = getRegion();
const config = getRegionConfig(region);

export const metadata: Metadata = {
  metadataBase: new URL(BASE_URL),
  title: {
    default: regionTitle(config.baseTitle, region),
    template: '%s | BuyWhere',
  },
  description: config.baseDescription,
  keywords: [...regionKeywords(region)],
  authors: [{ name: 'BuyWhere' }],
  creator: 'BuyWhere',
  openGraph: {
    type: 'website',
    locale: config.locale,
    siteName: 'BuyWhere',
  },
  twitter: {
    card: 'summary_large_image',
    site: '@buywhere',
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link rel="icon" href="/favicon.ico" />
      </head>
      <body>
        <header className="site-header">
          <nav className="nav-container">
            <a href="/" className="logo">
              BuyWhere
            </a>
            <div className="nav-links">
              <a href="/category/electronics">Electronics</a>
              <a href="/category/grocery">Grocery</a>
              <a href="/category/home">Home</a>
              <a href="/category/health">Health</a>
            </div>
          </nav>
        </header>
        <main>{children}</main>
        <footer className="site-footer">
          <div className="footer-container">
            <p>© 2026 BuyWhere. Prices updated daily.</p>
          </div>
        </footer>
      </body>
    </html>
  );
}
