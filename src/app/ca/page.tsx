import CountryLandingPage from "@/components/CountryLandingPage";
import { buildCountryLandingMetadata, countryLandingPages } from "@/lib/country-landings";

const config = countryLandingPages.ca;

export const metadata = buildCountryLandingMetadata(config);

export default function CanadaLandingPage() {
  return <CountryLandingPage config={config} />;
}
