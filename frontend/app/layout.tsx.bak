import type { Metadata } from 'next';
import './globals.css';

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'https://buywhere.ai';

export const metadata: Metadata = {
  metadataBase: new URL(BASE_URL),
  title: {
    default: 'BuyWhere — Compare prices across Singapore retailers',
    template: '%s | BuyWhere',
  },
  description: 'Find the best prices for electronics, groceries, home goods, and health products across Singapore\'s top retailers. AI-powered price comparisons.',
  keywords: ['price comparison', 'Singapore', 'electronics', 'groceries', 'buy', 'compare prices', 'online shopping'],
  authors: [{ name: 'BuyWhere' }],
  creator: 'BuyWhere',
  openGraph: {
    type: 'website',
    locale: 'en_SG',
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