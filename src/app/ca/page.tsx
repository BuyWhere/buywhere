import type { Metadata } from "next";
import CountryLandingPage from "@/components/CountryLandingPage";
import { buildCountryLandingMetadata, countryLandings } from "@/lib/country-landings";

const path = "/ca";
const config = countryLandings.ca;

export const metadata: Metadata = buildCountryLandingMetadata(path, config);

export default function caLandingPage() {
  return <CountryLandingPage config={config} path={path} />;
}
