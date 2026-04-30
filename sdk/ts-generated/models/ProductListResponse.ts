/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ProductResponse } from './ProductResponse';
export type ProductListResponse = {
    /**
     * Total number of matching products
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
    /**
     * Whether there are more results available
     */
    has_more: boolean;
    items: Array<ProductResponse>;
};

