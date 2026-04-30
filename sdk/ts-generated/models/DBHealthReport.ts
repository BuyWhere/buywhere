/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { DBConnectionHealth } from './DBConnectionHealth';
import type { DBPoolHealth } from './DBPoolHealth';
export type DBHealthReport = {
    /**
     * Whether database health check passed
     */
    ok: boolean;
    connection: DBConnectionHealth;
    pool: DBPoolHealth;
    /**
     * Health check timestamp
     */
    checked_at: string;
};

