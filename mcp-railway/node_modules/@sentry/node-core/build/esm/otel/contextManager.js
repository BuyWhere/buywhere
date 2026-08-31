import { SentryAsyncLocalStorageContextManager } from '@sentry/opentelemetry';

/**
 * This is a custom ContextManager for OpenTelemetry & Sentry.
 * It ensures that we create a new hub per context, so that the OTEL Context & the Sentry Scopes are always in sync.
 */
const SentryContextManager = SentryAsyncLocalStorageContextManager;

export { SentryContextManager };
//# sourceMappingURL=contextManager.js.map
