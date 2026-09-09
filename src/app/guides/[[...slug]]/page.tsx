import { permanentRedirect } from "next/navigation";

export default function GuidesRedirectPage() {
  permanentRedirect("/docs/");
}
