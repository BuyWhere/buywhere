import { redirect } from "next/navigation";

export function GET() {
  redirect("/.well-known/ai-plugin.json");
}
