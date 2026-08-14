import { permanentRedirect } from "next/navigation";

// /legal redirects to /privacy - the main legal hub
export default function LegalPage() {
  permanentRedirect("/privacy");
}
