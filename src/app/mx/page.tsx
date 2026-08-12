import type { Metadata } from "next";
import CountryLandingPage from "@/components/CountryLandingPage";
import { buildCountryLandingMetadata, countryLandings } from "@/lib/country-landings";

const path = "/mx";
const config = countryLandings.mx;

export const metadata: Metadata = buildCountryLandingMetadata(path, config);

export default function mxLandingPage() {
  return <CountryLandingPage config={config} path={path} />;
}
