import type { Metadata } from "next";
import CountryLandingPage from "@/components/CountryLandingPage";
import { buildCountryLandingMetadata, countryLandings } from "@/lib/country-landings";

const path = "/br";
const config = countryLandings.br;

export const metadata: Metadata = buildCountryLandingMetadata(path, config);

export default function brLandingPage() {
  return <CountryLandingPage config={config} path={path} />;
}
