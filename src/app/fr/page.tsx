import CountryLandingPage from "@/components/CountryLandingPage";
import { buildCountryLandingMetadata, countryLandingPages } from "@/lib/country-landings";

const config = countryLandingPages.fr;

export const metadata = buildCountryLandingMetadata(config);

export default function FranceLandingPage() {
  return <CountryLandingPage config={config} />;
}
