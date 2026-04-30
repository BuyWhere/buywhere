export default function LandingCodeDemo() {
  return (
    <section className="py-20 bg-gray-50">
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <div className="grid lg:grid-cols-5 gap-12 items-center">
          <div className="lg:col-span-3 bg-gray-900 rounded-xl overflow-hidden shadow-2xl">
            <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-700">
              <div className="w-3 h-3 rounded-full bg-red-500/70"></div>
              <div className="w-3 h-3 rounded-full bg-yellow-500/70"></div>
              <div className="w-3 h-3 rounded-full bg-green-500/70"></div>
              <span className="ml-2 text-xs text-gray-500 font-mono">search.js</span>
            </div>
            <pre className="p-4 text-sm text-gray-300 font-mono overflow-x-auto leading-relaxed">{`const response = await fetch(
  "https://api.buywhere.io/v1/products/search",
  {
    method: "POST",
    headers: {
      "Authorization": "Bearer bw_live_xxx",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      q: "wireless headphones",
      country: "US",
      retailers: ["amazon", "walmart"]
    })
  }
);

const { products } = await response.json();
// → [{ name, price, retailer, url, ... }]`}</pre>
          </div>

          <div className="lg:col-span-2 space-y-6">
            <div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">Semantic Search</h3>
              <p className="text-sm text-gray-500 leading-relaxed">
                Natural language queries return relevant products across all retailers with a consistent schema.
              </p>
            </div>

            <div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">Real-time Pricing</h3>
              <p className="text-sm text-gray-500 leading-relaxed">
                Live price data from Amazon, Walmart, Target, and Best Buy — updated throughout the day.
              </p>
            </div>

            <div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">Easy Integration</h3>
              <p className="text-sm text-gray-500 leading-relaxed">
                RESTful API with client libraries for JavaScript, Python, and first-class MCP support.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}