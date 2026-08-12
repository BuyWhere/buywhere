import type { Metadata } from "next";
import CountryLandingPage from "@/components/CountryLandingPage";
import { buildCountryLandingMetadata, countryLandings } from "@/lib/country-landings";

const path = "/au";
const config = countryLandings.au;

export const metadata: Metadata = buildCountryLandingMetadata(path, config);

export default function auLandingPage() {
  return <CountryLandingPage config={config} path={path} />;
}
