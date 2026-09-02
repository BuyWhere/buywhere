import CountryLandingPage from "@/components/CountryLandingPage";
import { buildCountryLandingMetadata, countryLandingPages } from "@/lib/country-landings";

const config = countryLandingPages.br;

export const metadata = buildCountryLandingMetadata(config);

export default function BrazilLandingPage() {
  return <CountryLandingPage config={config} />;
}
