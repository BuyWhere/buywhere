import type { Metadata } from "next";
import CountryLandingPage from "@/components/CountryLandingPage";
import { buildCountryLandingMetadata, countryLandings } from "@/lib/country-landings";

const path = "/ae";
const config = countryLandings.ae;

export const metadata: Metadata = buildCountryLandingMetadata(path, config);

export default function aeLandingPage() {
  return <CountryLandingPage config={config} path={path} />;
}
