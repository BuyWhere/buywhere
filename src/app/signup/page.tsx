import { permanentRedirect } from "next/navigation";

export default function SignupPage() {
  // Signup is gated behind /login — redirect to login which handles the signup flow
  permanentRedirect("/login");
}
