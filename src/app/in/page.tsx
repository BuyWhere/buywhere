import type { Metadata } from "next";
import CountryLandingPage from "@/components/CountryLandingPage";
import { buildCountryLandingMetadata, countryLandings } from "@/lib/country-landings";

const path = "/in";
const config = countryLandings.in;

export const metadata: Metadata = buildCountryLandingMetadata(path, config);

export default function inLandingPage() {
  return <CountryLandingPage config={config} path={path} />;
}
