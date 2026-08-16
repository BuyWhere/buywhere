import CountryLandingPage from "@/components/CountryLandingPage";
import { buildCountryLandingMetadata, countryLandingPages } from "@/lib/country-landings";

const config = countryLandingPages.sg;

export const metadata = buildCountryLandingMetadata(config);

export default function SingaporeLandingPage() {
  return <CountryLandingPage config={config} />;
}
