import CountryLandingPage from "@/components/CountryLandingPage";
import { buildCountryLandingMetadata, countryLandingPages } from "@/lib/country-landings";

const config = countryLandingPages.mx;

export const metadata = buildCountryLandingMetadata(config);

export default function MexicoLandingPage() {
  return <CountryLandingPage config={config} />;
}
