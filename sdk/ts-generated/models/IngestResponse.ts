/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { IngestError } from './IngestError';
export type IngestResponse = {
    /**
     * Ingestion run ID
     */
    run_id: number;
    /**
     * Overall run status
     */
    status: 'completed' | 'completed_with_errors' | 'failed' | 'running';
    /**
     * Number of new rows inserted
     */
    rows_inserted: number;
    /**
     * Number of existing rows updated
     */
    rows_updated: number;
    /**
     * Number of rows that failed
     */
    rows_failed: number;
    errors: Array<IngestError>;
};

