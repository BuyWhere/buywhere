/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type DBPoolHealth = {
    /**
     * Total pool size
     */
    size: number;
    /**
     * Connections checked in
     */
    checked_in: number;
    /**
     * Connections checked out
     */
    checked_out: number;
    /**
     * Overflow pool size
     */
    overflow: number;
    /**
     * Invalid connections
     */
    invalid?: number;
};

