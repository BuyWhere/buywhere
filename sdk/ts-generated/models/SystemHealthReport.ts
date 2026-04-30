/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { DBHealthReport } from './DBHealthReport';
import type { ScraperHealthReport } from './ScraperHealthReport';
export type SystemHealthReport = {
    /**
     * Report generation timestamp
     */
    generated_at: string;
    db: DBHealthReport;
    scrapers: ScraperHealthReport;
};

