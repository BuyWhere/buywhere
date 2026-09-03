import CountryLandingPage from "@/components/CountryLandingPage";
import { buildCountryLandingMetadata, countryLandingPages } from "@/lib/country-landings";

const config = countryLandingPages.ae;

export const metadata = buildCountryLandingMetadata(config);

export default function UnitedArabEmiratesLandingPage() {
  return <CountryLandingPage config={config} />;
}
