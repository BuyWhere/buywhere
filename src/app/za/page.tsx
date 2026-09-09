import CountryLandingPage from "@/components/CountryLandingPage";
import { buildCountryLandingMetadata, countryLandingPages } from "@/lib/country-landings";

const config = countryLandingPages.za;

export const metadata = buildCountryLandingMetadata(config);

export default function SouthAfricaLandingPage() {
  return <CountryLandingPage config={config} />;
}
