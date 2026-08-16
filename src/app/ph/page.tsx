import CountryLandingPage from "@/components/CountryLandingPage";
import { buildCountryLandingMetadata, countryLandingPages } from "@/lib/country-landings";

const config = countryLandingPages.ph;

export const metadata = buildCountryLandingMetadata(config);

export default function PhilippinesLandingPage() {
  return <CountryLandingPage config={config} />;
}
