import { permanentRedirect } from "next/navigation";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Product — BuyWhere",
  robots: { index: false },
};

export default function ProductPage() {
  permanentRedirect("/compare/");
}
