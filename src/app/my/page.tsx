import CountryLandingPage from "@/components/CountryLandingPage";
import { buildCountryLandingMetadata, countryLandingPages } from "@/lib/country-landings";

const config = countryLandingPages.my;

export const metadata = buildCountryLandingMetadata(config);

export default function MalaysiaLandingPage() {
  return <CountryLandingPage config={config} />;
}