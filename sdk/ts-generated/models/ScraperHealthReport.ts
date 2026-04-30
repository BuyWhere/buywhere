/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ScraperHealth } from './ScraperHealth';
export type ScraperHealthReport = {
    generated_at: string;
    scrapers: Array<ScraperHealth>;
    total_scrapers: number;
    healthy_count: number;
    unhealthy_count: number;
};

