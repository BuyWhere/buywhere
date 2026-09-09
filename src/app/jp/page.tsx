import CountryLandingPage from "@/components/CountryLandingPage";
import { buildCountryLandingMetadata, countryLandingPages } from "@/lib/country-landings";

const config = countryLandingPages.jp;

export const metadata = buildCountryLandingMetadata(config);

export default function JapanLandingPage() {
  return <CountryLandingPage config={config} />;
}
