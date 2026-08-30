import { useRouter } from "next/router";
import { NotFoundBrand, NotFoundGeneric } from "@/components/not-found/NotFoundContent";

export default function NotFoundPage() {
  const router = useRouter();
  const type = Array.isArray(router.query.type) ? router.query.type[0] : router.query.type;
  const slug = Array.isArray(router.query.slug) ? router.query.slug[0] : router.query.slug;

  if (type === "brand" && slug) {
    return <NotFoundBrand slug={slug} />;
  }

  return <NotFoundGeneric />;
}
