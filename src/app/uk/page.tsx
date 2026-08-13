import CountryLandingPage from "@/components/CountryLandingPage";
import { buildCountryLandingMetadata, countryLandingPages } from "@/lib/country-landings";

const config = countryLandingPages.uk;

export const metadata = buildCountryLandingMetadata(config);

export default function UnitedKingdomLandingPage() {
  return <CountryLandingPage config={config} />;
}
