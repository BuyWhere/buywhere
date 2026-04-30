/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type ScraperHealth = {
    source: string;
    last_run_at?: string | null;
    last_run_status?: string | null;
    last_rows_inserted?: number | null;
    last_rows_updated?: number | null;
    last_rows_failed?: number | null;
    product_count: number;
    is_healthy: boolean;
    hours_since_last_run?: number | null;
    error_message?: string | null;
};

