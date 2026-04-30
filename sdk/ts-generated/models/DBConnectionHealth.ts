/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type DBConnectionHealth = {
    /**
     * Whether database connection is healthy
     */
    ok: boolean;
    /**
     * Database latency in milliseconds
     */
    latency_ms: number;
    /**
     * Error message if connection failed
     */
    error?: string | null;
};

