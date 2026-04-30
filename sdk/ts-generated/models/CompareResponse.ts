/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CompareMatch } from './CompareMatch';
export type CompareResponse = {
    /**
     * ID of the source product
     */
    source_product_id: number;
    /**
     * Name of the source product
     */
    source_product_name: string;
    matches: Array<CompareMatch>;
    /**
     * Total number of matching products found
     */
    total_matches: number;
};

