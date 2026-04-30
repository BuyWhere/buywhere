/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type IngestionRunSummary = {
    id: number;
    source: string;
    status: 'running' | 'completed' | 'failed' | 'cancelled';
    rows_inserted: number;
    rows_updated: number;
    rows_failed: number;
    started_at: string;
    finished_at: string | null;
};

