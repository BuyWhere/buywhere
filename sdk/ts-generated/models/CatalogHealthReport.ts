/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { DeduplicationReport } from './DeduplicationReport';
import type { FreshnessReport } from './FreshnessReport';
import type { SchemaComplianceReport } from './SchemaComplianceReport';
export type CatalogHealthReport = {
    generated_at: string;
    total_indexed: number;
    by_platform: Record<string, number>;
    compliance: SchemaComplianceReport;
    deduplication: DeduplicationReport;
    freshness: FreshnessReport;
};

