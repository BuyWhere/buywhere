import { toSiteUrl } from "@/lib/site-url";

export default function Head() {
  return (
    <>
      <meta property="og:image" content={toSiteUrl("/og-image.png")} />
      <meta property="og:image:width" content="1200" />
      <meta property="og:image:height" content="630" />
      <meta property="og:image:alt" content="BuyWhere API Status — Operational Health" />
      <meta name="twitter:image" content={toSiteUrl("/og-image.png")} />
    </>
  );
}
