// /sign-up redirect is configured in next.config.mjs (config-level redirect required
// for production HTTP 308 rather than App Router shell-render)
// NOTE: do not convert to page-level permanentRedirect - BUY-67767 gotcha
export default function SignUpPage() {
  return null;
}
