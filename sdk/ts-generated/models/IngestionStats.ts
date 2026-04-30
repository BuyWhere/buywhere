/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type IngestionStats = {
    /**
     * Total number of ingestion runs
     */
    total_runs: number;
    /**
     * Number of successfully completed runs
     */
    completed_runs: number;
    /**
     * Number of failed runs
     */
    failed_runs: number;
    /**
     * Number of currently running runs
     */
    running_runs: number;
    /**
     * Total rows inserted across all runs
     */
    total_rows_inserted: number;
    /**
     * Total rows updated across all runs
     */
    total_rows_updated: number;
    /**
     * Total rows failed across all runs
     */
    total_rows_failed: number;
};

