import type { Metadata } from "next";
import CountryLandingPage from "@/components/CountryLandingPage";
import { buildCountryLandingMetadata, countryLandings } from "@/lib/country-landings";

const path = "/za";
const config = countryLandings.za;

export const metadata: Metadata = buildCountryLandingMetadata(path, config);

export default function zaLandingPage() {
  return <CountryLandingPage config={config} path={path} />;
}
