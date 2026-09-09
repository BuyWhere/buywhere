import type { GetServerSideProps, Metadata } from "next";
import Head from "next/head";
import Link from "next/link";
import Nav from "../components/Nav";
import Footer from "../components/Footer";
import { toSiteUrl } from "../lib/site-url";

const CART_DESCRIPTION =
  "Review the products saved to your BuyWhere cart before comparing prices and checking out with the retailer.";

const CART_CANONICAL = toSiteUrl("/cart");

export const metadata: Metadata = {
  title: "Cart | BuyWhere",
  description: CART_DESCRIPTION,
  alternates: {
    canonical: CART_CANONICAL,
  },
  robots: {
    index: false,
    follow: true,
  },
};

export const getServerSideProps: GetServerSideProps = async ({ req }) => {
  const hasSession = Boolean(req.cookies.bw_auth_token || req.cookies.bw_dashboard_key);

  if (!hasSession) {
    return {
      redirect: {
        destination: "/login?next=%2Fcart",
        permanent: false,
      },
    };
  }

  return { props: {} };
};

export default function CartPage() {
  return (
    <div className="flex min-h-screen flex-col bg-white text-slate-950">
      <Head>
        <title>Cart | BuyWhere</title>
        <meta name="description" content={CART_DESCRIPTION} />
        <meta name="robots" content="noindex,follow" />
        <link rel="canonical" href={CART_CANONICAL} />
      </Head>
      <Nav />
      <main id="main-content" className="flex-1 bg-gradient-to-b from-slate-50 to-white py-16">
        <div className="mx-auto max-w-4xl px-4 sm:px-6">
          <section className="rounded-[32px] border border-slate-200 bg-white p-8 shadow-sm sm:p-10">
            <div className="inline-flex rounded-full bg-indigo-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-indigo-700">
              Shopping cart
            </div>
            <h1 className="mt-4 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
              Your cart is empty
            </h1>
            <p className="mt-4 max-w-2xl text-base leading-7 text-slate-600">
              Products you save from BuyWhere search results will appear here. Start a search to compare prices across stores,
              then return to your cart when you are ready to review your picks.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link
                href="/search"
                className="inline-flex items-center justify-center rounded-xl bg-indigo-600 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-indigo-700"
              >
                Find products
              </Link>
              <Link
                href="/stores"
                className="inline-flex items-center justify-center rounded-xl border border-slate-200 px-5 py-3 text-sm font-semibold text-slate-700 transition-colors hover:border-indigo-200 hover:text-indigo-700"
              >
                Browse stores
              </Link>
            </div>
          </section>
        </div>
      </main>
      <Footer />
    </div>
  );
}
