/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type IngestionRunResponse = {
    id: number;
    source: string;
    started_at: string;
    finished_at?: string | null;
    rows_inserted?: number | null;
    rows_updated?: number | null;
    rows_failed?: number | null;
    status: 'running' | 'completed' | 'failed' | 'cancelled';
    /**
     * Error message if run failed
     */
    error_message?: string | null;
};

