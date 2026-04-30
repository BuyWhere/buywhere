/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { StaleProductInfo } from './StaleProductInfo';
export type FreshnessReport = {
    total_products: number;
    stale_products: number;
    stale_rate: number;
    re_scrape_count: number;
    by_platform: Record<string, number>;
    sample_stale: Array<StaleProductInfo>;
};

