import type { Metadata } from "next";
import CountryLandingPage from "@/components/CountryLandingPage";
import { buildCountryLandingMetadata, countryLandings } from "@/lib/country-landings";

const path = "/jp";
const config = countryLandings.jp;

export const metadata: Metadata = buildCountryLandingMetadata(path, config);

export default function jpLandingPage() {
  return <CountryLandingPage config={config} path={path} />;
}
