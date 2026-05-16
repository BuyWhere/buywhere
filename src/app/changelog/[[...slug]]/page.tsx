import { permanentRedirect } from "next/navigation";

export default function ChangelogRedirectPage() {
  permanentRedirect("/blog/");
}
