import { permanentRedirect } from "next/navigation";

export default function ProductsIndexPage() {
  permanentRedirect("/compare/");
}
