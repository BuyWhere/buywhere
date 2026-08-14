import { permanentRedirect } from "next/navigation";

// /sign-up redirects to /register
export default function SignUpPage() {
  permanentRedirect("/register");
}
