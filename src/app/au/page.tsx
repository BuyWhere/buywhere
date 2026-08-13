import CountryLandingPage from "@/components/CountryLandingPage";
import { buildCountryLandingMetadata, countryLandingPages } from "@/lib/country-landings";

const config = countryLandingPages.au;

export const metadata = buildCountryLandingMetadata(config);

export default function AustraliaLandingPage() {
  return <CountryLandingPage config={config} />;
}
