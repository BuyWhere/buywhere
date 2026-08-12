import type { Metadata } from "next";
import CountryLandingPage from "@/components/CountryLandingPage";
import { buildCountryLandingMetadata, countryLandings } from "@/lib/country-landings";

const path = "/eu";
const config = countryLandings.eu;

export const metadata: Metadata = buildCountryLandingMetadata(path, config);

export default function euLandingPage() {
  return <CountryLandingPage config={config} path={path} />;
}
