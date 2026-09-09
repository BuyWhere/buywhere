import CountryLandingPage from "@/components/CountryLandingPage";
import { buildCountryLandingMetadata, countryLandingPages } from "@/lib/country-landings";

const config = countryLandingPages.kr;

export const metadata = buildCountryLandingMetadata(config);

export default function SouthKoreaLandingPage() {
  return <CountryLandingPage config={config} />;
}
