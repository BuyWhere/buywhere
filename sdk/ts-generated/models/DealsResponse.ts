/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { DealItem } from './DealItem';
export type DealsResponse = {
    /**
     * Total number of matching deals
     */
    total: number;
    /**
     * Results per page
     */
    limit: number;
    /**
     * Pagination offset
     */
    offset: number;
    items: Array<DealItem>;
};

