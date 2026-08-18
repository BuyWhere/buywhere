import CountryLandingPage from "@/components/CountryLandingPage";
import { buildCountryLandingMetadata, countryLandingPages } from "@/lib/country-landings";

const config = countryLandingPages.eu;

export const metadata = buildCountryLandingMetadata(config);

export default function EuropeLandingPage() {
  return <CountryLandingPage config={config} />;
}
