import type { Metadata } from "next";
import CountryLandingPage from "@/components/CountryLandingPage";
import { buildCountryLandingMetadata, countryLandings } from "@/lib/country-landings";

const path = "/fr";
const config = countryLandings.fr;

export const metadata: Metadata = buildCountryLandingMetadata(path, config);

export default function frLandingPage() {
  return <CountryLandingPage config={config} path={path} />;
}
