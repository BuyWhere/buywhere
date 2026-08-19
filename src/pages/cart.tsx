import type { GetServerSideProps } from "next";
import type { ParsedUrlQuery } from "querystring";
import Link from "next/link";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import Schema from "@/components/Schema";
import { buildWebPageSchema } from "@/lib/page-schema";

interface CartPageProps {
  isAuthenticated: boolean;
}

export const getServerSideProps: GetServerSideProps<CartPageProps, ParsedUrlQuery> = async (context) => {
  const cookieHeader = context.req?.headers?.cookie ?? "";
  const apiKey = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("bw_dashboard_key="))
    ?.split("=")[1];

  if (!apiKey) {
    return {
      redirect: {
        destination: "/login?next=%2Fcart",
        permanent: false,
      },
    };
  }

  return {
    props: {
      isAuthenticated: true,
    },
  };
};

export default function CartPage() {
  const schema = buildWebPageSchema({
    path: "/cart",
    name: "Your Cart | BuyWhere",
    description: "Review the products saved in your BuyWhere cart.",
    breadcrumb: [
      { name: "Home", path: "/" },
      { name: "Cart", path: "/cart" },
    ],
  });

  return (
    <>
      <Schema data={schema} />
      <div className="flex min-h-screen flex-col bg-slate-50">
        <Nav />

        <main id="main-content" tabIndex={-1} className="flex-1">
          <section className="py-16">
            <div className="mx-auto max-w-3xl px-4 sm:px-6">
              <div className="rounded-[32px] border border-slate-200 bg-white p-8 shadow-sm sm:p-10">
                <div className="inline-flex rounded-full bg-indigo-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-indigo-700">
                  Cart
                </div>

                <h1 className="mt-4 text-3xl font-bold tracking-tight text-slate-900">
                  Your cart is empty.
                </h1>
                <p className="mt-4 text-sm leading-7 text-slate-600">
                  Products you add from search results and price comparisons will appear here.
                </p>

                <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                  <Link
                    href="/search"
                    className="inline-flex items-center justify-center rounded-xl bg-indigo-600 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-indigo-700"
                  >
                    Browse products
                  </Link>
                  <Link
                    href="/categories"
                    className="inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50"
                  >
                    Shop by category
                  </Link>
                </div>
              </div>
            </div>
          </section>
        </main>

        <Footer />
      </div>
    </>
  );
}
