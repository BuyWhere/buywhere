/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type IngestionRunUpdate = {
    /**
     * Number of rows inserted so far
     */
    rows_inserted?: number | null;
    /**
     * Number of rows updated so far
     */
    rows_updated?: number | null;
    /**
     * Number of rows failed so far
     */
    rows_failed?: number | null;
    /**
     * Status override
     */
    status?: 'running' | 'completed' | 'failed' | 'cancelled' | null;
    /**
     * Error message if status is failed
     */
    error_message?: string | null;
};

