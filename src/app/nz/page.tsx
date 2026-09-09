import CountryLandingPage from "@/components/CountryLandingPage";
import { buildCountryLandingMetadata, countryLandingPages } from "@/lib/country-landings";

const config = countryLandingPages.nz;

export const metadata = buildCountryLandingMetadata(config);

export default function NewZealandLandingPage() {
  return <CountryLandingPage config={config} />;
}
