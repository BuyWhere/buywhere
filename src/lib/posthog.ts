export const POSTHOG_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY ?? "phc_B3cS3aNdwTfr2UMykvuShWNnnTaPf5sfHLUQ8FkNHqCc";
// BUY-79258: first-party reverse proxy (see next.config.mjs /ingest/ph) so
// ad-blockers that filter us.i.posthog.com cannot zero client capture.
export const POSTHOG_HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "/ingest/ph";
export const POSTHOG_UI_HOST = process.env.NEXT_PUBLIC_POSTHOG_UI_HOST ?? "https://us.posthog.com";
