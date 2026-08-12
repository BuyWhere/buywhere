import type { Metadata } from "next";
import CountryLandingPage from "@/components/CountryLandingPage";
import { buildCountryLandingMetadata, countryLandings } from "@/lib/country-landings";

const path = "/de";
const config = countryLandings.de;

export const metadata: Metadata = buildCountryLandingMetadata(path, config);

export default function deLandingPage() {
  return <CountryLandingPage config={config} path={path} />;
}
