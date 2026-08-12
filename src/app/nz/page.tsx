import type { Metadata } from "next";
import CountryLandingPage from "@/components/CountryLandingPage";
import { buildCountryLandingMetadata, countryLandings } from "@/lib/country-landings";

const path = "/nz";
const config = countryLandings.nz;

export const metadata: Metadata = buildCountryLandingMetadata(path, config);

export default function nzLandingPage() {
  return <CountryLandingPage config={config} path={path} />;
}
