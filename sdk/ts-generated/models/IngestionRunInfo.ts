/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type IngestionRunInfo = {
    /**
     * Source platform
     */
    source?: string | null;
    /**
     * Last ingestion run timestamp
     */
    last_run_at?: string | null;
    /**
     * Last run status
     */
    last_run_status?: string | null;
    /**
     * Rows inserted in last run
     */
    last_rows_inserted?: number | null;
    /**
     * Rows updated in last run
     */
    last_rows_updated?: number | null;
};

