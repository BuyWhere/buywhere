import Link from "next/link";
import NewsletterBanner from "@/components/NewsletterBanner";
import { AffiliateDisclosure } from "@/components/ui/AffiliateDisclosure";

const COPYRIGHT_YEAR = 2026;

export default function Footer() {
  return (
    <>
      <NewsletterBanner />
      <footer role="contentinfo" aria-label="Site footer" className="bg-gray-50 border-t border-gray-200 mt-auto">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-12">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
          <div className="col-span-2 md:col-span-1">
            <div className="font-bold text-lg text-indigo-600 mb-3">
              BuyWhere
            </div>
            <p className="text-sm text-gray-500 leading-relaxed">
              API key in 60 seconds · No sales call · Works with API or MCP
            </p>
          </div>

          <div>
            <h4 id="footer-h-product" className="text-sm font-semibold text-gray-900 mb-3">Product</h4>
            <ul aria-labelledby="footer-h-product" className="space-y-2 text-sm text-gray-500" role="list">
              <li role="listitem"><Link href="/quickstart" className="hover:text-indigo-600">Quickstart</Link></li>
              <li><Link href="/merchants" className="hover:text-indigo-600">Merchants</Link></li>
              <li><Link href="/partners" className="hover:text-indigo-600">Partners</Link></li>
              <li><Link href="/developers" className="hover:text-indigo-600">Developers</Link></li>
            </ul>
          </div>

          <div>
            <h4 id="footer-h-company" className="text-sm font-semibold text-gray-900 mb-3">Company</h4>
            <ul aria-labelledby="footer-h-company" className="space-y-2 text-sm text-gray-500" role="list">
              <li role="listitem"><Link href="/about" className="hover:text-indigo-600">About</Link></li>
              <li><Link href="/use-cases" className="hover:text-indigo-600">Use Cases</Link></li>
              <li><Link href="/contact" className="hover:text-indigo-600">Contact</Link></li>
              <li><Link href="/docs" className="hover:text-indigo-600">Help &amp; Support</Link></li>
              <li><a href="https://status.buywhere.ai" target="_blank" rel="noopener noreferrer" className="hover:text-indigo-600">System Status</a></li>
            </ul>
          </div>

          <div>
            <h4 id="footer-h-legal" className="text-sm font-semibold text-gray-900 mb-3">Legal</h4>
            <ul aria-labelledby="footer-h-legal" className="space-y-2 text-sm text-gray-500" role="list">
              <li role="listitem"><Link href="/terms" className="hover:text-indigo-600">Terms of Service</Link></li>
              <li><Link href="/privacy" className="hover:text-indigo-600">Privacy Policy</Link></li>
              <li><Link href="/affiliate-disclosure" className="hover:text-indigo-600">Affiliate Disclosure</Link></li>
            </ul>
          </div>

          <div>
            <h4 id="footer-h-connect" className="text-sm font-semibold text-gray-900 mb-3">Connect</h4>
            <ul aria-labelledby="footer-h-connect" className="space-y-2 text-sm text-gray-500" role="list">
              <li role="listitem"><a href="https://t.me/buywhere_bot" target="_blank" rel="noopener noreferrer" className="hover:text-indigo-600">Telegram</a></li>
              <li><a href="https://github.com/BuyWhere/buywhere-mcp" target="_blank" rel="noopener noreferrer" className="hover:text-indigo-600">GitHub</a></li>
            </ul>
          </div>
        </div>

        <div className="mt-6 pt-6 border-t border-gray-200">
          <div className="mb-4">
            <AffiliateDisclosure variant="inline" />
          </div>
          <div className="flex flex-col sm:flex-row justify-between items-center gap-2 text-sm text-gray-500">
            <span tabIndex={0} aria-label={`Copyright ${COPYRIGHT_YEAR} BuyWhere Pte. Ltd. All rights reserved.`}>© {COPYRIGHT_YEAR} BuyWhere Pte. Ltd. All rights reserved.</span>
          </div>
        </div>
      </div>
    </footer>
    </>
  );
}
