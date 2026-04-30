/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type IngestionRunComplete = {
    /**
     * Final status: completed, failed, or cancelled
     */
    status: 'completed' | 'failed' | 'cancelled';
    /**
     * Final count of rows inserted
     */
    rows_inserted?: number | null;
    /**
     * Final count of rows updated
     */
    rows_updated?: number | null;
    /**
     * Final count of rows failed
     */
    rows_failed?: number | null;
    /**
     * Error message if failed
     */
    error_message?: string | null;
};

