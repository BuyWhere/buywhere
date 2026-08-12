import type { Metadata } from "next";
import CountryLandingPage from "@/components/CountryLandingPage";
import { buildCountryLandingMetadata, countryLandings } from "@/lib/country-landings";

const path = "/kr";
const config = countryLandings.kr;

export const metadata: Metadata = buildCountryLandingMetadata(path, config);

export default function krLandingPage() {
  return <CountryLandingPage config={config} path={path} />;
}
