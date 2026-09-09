import CountryLandingPage from "@/components/CountryLandingPage";
import { buildCountryLandingMetadata, countryLandingPages } from "@/lib/country-landings";

const config = countryLandingPages.de;

export const metadata = buildCountryLandingMetadata(config);

export default function GermanyLandingPage() {
  return <CountryLandingPage config={config} />;
}
