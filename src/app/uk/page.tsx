import type { Metadata } from "next";
import CountryLandingPage from "@/components/CountryLandingPage";
import { buildCountryLandingMetadata, countryLandings } from "@/lib/country-landings";

const path = "/uk";
const config = countryLandings.uk;

export const metadata: Metadata = buildCountryLandingMetadata(path, config);

export default function ukLandingPage() {
  return <CountryLandingPage config={config} path={path} />;
}
