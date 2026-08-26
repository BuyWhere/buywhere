Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });

const opentelemetry = require('@sentry/opentelemetry');

/**
 * This is a custom ContextManager for OpenTelemetry & Sentry.
 * It ensures that we create a new hub per context, so that the OTEL Context & the Sentry Scopes are always in sync.
 */
const SentryContextManager = opentelemetry.SentryAsyncLocalStorageContextManager;

exports.SentryContextManager = SentryContextManager;
//# sourceMappingURL=contextManager.js.map
