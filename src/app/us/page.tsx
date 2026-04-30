import Footer from "@/components/Footer";
import Link from "next/link";

export default function USLandingPage() {
  return (
    <div className="flex flex-col min-h-screen">
      <header className="sticky top-0 z-50 bg-white/90 backdrop-blur border-b border-gray-100">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 flex items-center justify-between h-16">
          <Link href="/" className="flex items-center gap-2 font-bold text-lg text-indigo-600">
            <svg width="28" height="28" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect width="28" height="28" rx="6" fill="#4f46e5" />
              <path d="M7 10h14M7 14h10M7 18h12" stroke="white" strokeWidth="2" strokeLinecap="round" />
            </svg>
            BuyWhere
          </Link>
          <div className="flex items-center gap-4 text-sm font-medium text-gray-600">
            <Link href="/compare/us" className="hover:text-indigo-600 transition-colors">
              Browse Products
            </Link>
            <Link href="/dashboard" className="hover:text-indigo-600 transition-colors">
              Dashboard
            </Link>
            <Link href="/api-keys" className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors">
              Get API Key
            </Link>
          </div>
        </div>
      </header>

      <section className="bg-white py-20 md:py-24">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 text-center max-w-3xl mx-auto">
          <h1 className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-bold text-gray-900 leading-tight" style={{ lineHeight: 1.1 }}>
            Find any product. Compare prices across Amazon, Walmart, and Target.
          </h1>
          <p className="mt-6 text-lg md:text-xl text-gray-600 max-w-2xl mx-auto">
            Find any product. Compare prices across Amazon, Walmart, and Target so you always know where to find the best deal.
          </p>
        </div>
      </section>

      <section className="py-16 bg-gray-50">
        <div className="max-w-4xl mx-auto px-4 sm:px-6">
          <h2 className="text-2xl md:text-3xl font-bold text-gray-900 text-center mb-12">
            How BuyWhere helps you shop smarter
          </h2>
          <div className="grid gap-8 md:grid-cols-3">
            <div className="text-center">
              <div className="w-14 h-14 bg-indigo-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <svg className="w-7 h-7 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </div>
              <h3 className="font-semibold text-gray-900 mb-2">Search once, compare everywhere</h3>
              <p className="text-sm text-gray-600">Enter a product name or URL and instantly see prices from Amazon, Walmart, Target, and more.</p>
            </div>
            <div className="text-center">
              <div className="w-14 h-14 bg-indigo-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <svg className="w-7 h-7 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                </svg>
              </div>
              <h3 className="font-semibold text-gray-900 mb-2">Find the lowest price</h3>
              <p className="text-sm text-gray-600">We highlight the best deals so you can save money without visiting multiple websites.</p>
            </div>
            <div className="text-center">
              <div className="w-14 h-14 bg-indigo-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <svg className="w-7 h-7 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h3 className="font-semibold text-gray-900 mb-2">Trustworthy data</h3>
              <p className="text-sm text-gray-600">Prices updated daily with stock status so you know what&apos;s available before you buy.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="py-16 bg-white">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 text-center">
          <h2 className="text-2xl md:text-3xl font-bold text-gray-900 mb-4">
            Ready to find the best price?
          </h2>
          <p className="text-gray-600 mb-8 max-w-xl mx-auto">
            Join thousands of smart shoppers who compare prices on BuyWhere before making a purchase.
          </p>
          <div className="flex flex-wrap justify-center gap-4">
            <Link
              href="/compare/us"
              className="inline-flex items-center justify-center px-6 py-3 bg-indigo-600 text-white font-semibold rounded-lg hover:bg-indigo-700 transition-colors"
            >
              Start comparing
            </Link>
            <Link
              href="/api-keys"
              className="inline-flex items-center justify-center px-6 py-3 border-2 border-gray-200 text-gray-700 font-semibold rounded-lg hover:border-gray-300 hover:bg-gray-50 transition-colors"
            >
              Get API access
            </Link>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
}