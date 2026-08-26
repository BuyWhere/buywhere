import type { Attributes, AttributeValue } from '@opentelemetry/api';
type RawResourceAttribute = [string, AttributeValue | undefined];
/**
 * Minimal Resource implementation that satisfies the OpenTelemetry Resource interface
 * used by BasicTracerProvider, without depending on `@opentelemetry/resources`.
 */
declare class SentryResource {
    private _attributes;
    constructor(attributes: Attributes);
    get attributes(): Attributes;
    merge(other: SentryResource | null): SentryResource;
    getRawAttributes(): RawResourceAttribute[];
}
/**
 * Returns a Resource for use in Sentry's OpenTelemetry TracerProvider setup.
 *
 * Combines the default OTel SDK telemetry attributes with Sentry-specific
 * service attributes, equivalent to what was previously done via:
 * `defaultResource().merge(resourceFromAttributes({ ... }))`
 */
export declare function getSentryResource(serviceName: string): SentryResource;
export {};
//# sourceMappingURL=resource.d.ts.map