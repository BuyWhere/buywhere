import type { Metadata } from "next";
import CountryLandingPage from "@/components/CountryLandingPage";
import { buildCountryLandingMetadata, countryLandings } from "@/lib/country-landings";

const path = "/gb";
const config = countryLandings.gb;

export const metadata: Metadata = buildCountryLandingMetadata(path, config);

export default function gbLandingPage() {
  return <CountryLandingPage config={config} path={path} />;
}
