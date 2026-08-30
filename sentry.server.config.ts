import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.SENTRY_DSN || "https://examplePublicKey@o0.ingest.us.sentry.io/0",
  tracesSampleRate: 0,
});
