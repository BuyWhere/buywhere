import CountryLandingPage from "@/components/CountryLandingPage";
import { buildCountryLandingMetadata, countryLandingPages } from "@/lib/country-landings";

const config = countryLandingPages.in;

export const metadata = buildCountryLandingMetadata(config);

export default function IndiaLandingPage() {
  return <CountryLandingPage config={config} />;
}
