import CountryLandingPage from "@/components/CountryLandingPage";
import { buildCountryLandingMetadata, countryLandingPages } from "@/lib/country-landings";

const config = countryLandingPages.gb;

export const metadata = buildCountryLandingMetadata(config);

export default function GreatBritainLandingPage() {
  return <CountryLandingPage config={config} />;
}
