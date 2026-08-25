import {
  resolveHreflangMap,
  seoLandingPages,
} from "@/lib/seo-landing-pages";

// BUY-75121: emit lowercase `hreflang` siblings for every dynamic
// `/[seo-page]` intent route. The Next.js 14.2.35 Metadata API
// (`alternates.languages`) emits `hrefLang` (camelCase), which fails the
// case-sensitive BUY-74869 v3.1 gate and is non-conformant with HTML spec.
// Bypassing the Metadata API here lets us render the spec-correct lowercase
// attribute inside the document <head>. Precedent: src/app/status/head.tsx,
// which the live https://buywhere.ai/status page renders correctly.
interface HeadProps {
  params: Promise<{ "seo-page": string }>;
}

export default async function SeoPageHead({ params }: HeadProps) {
  const { "seo-page": slug } = await params;
  const config = seoLandingPages[slug];
  if (!config) return null;
  const map = resolveHreflangMap(config, seoLandingPages);
  return (
    <>
      {Object.entries(map).map(([code, url]) => (
        // React's TS types for HTMLLinkElement only accept `hrefLang` (which
        // renders as hrefLang=... camelCase in HTML, defeating the whole
        // point of this file). The HTML spec attribute is lowercase
        // `hreflang`, and React serializes the lowercase JSX prop verbatim
        // to the rendered HTML. Suppress the type error so we render the
        // spec-correct lowercase attribute that the v3.1 gate regex
        // matches.
        // @ts-expect-error TS2322 -- React HTMLLinkElement types use hrefLang, but HTML spec is hreflang.
        <link key={code} rel="alternate" hreflang={code} href={url} />
      ))}
    </>
  );
}