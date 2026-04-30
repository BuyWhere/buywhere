/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { PlatformCompliance } from './PlatformCompliance';
export type SchemaComplianceReport = {
    total_products: number;
    compliant_products: number;
    compliance_rate: number;
    by_platform: Array<PlatformCompliance>;
    missing_title: number;
    missing_price: number;
    missing_source: number;
    missing_source_id: number;
    missing_url: number;
    incomplete_products: number;
};

