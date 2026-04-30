/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type CompareMatrixRequest = {
    /**
     * List of product IDs to compare (2-20 products)
     */
    product_ids: Array<number>;
    /**
     * Minimum price filter for matches
     */
    min_price?: number | null;
    /**
     * Maximum price filter for matches
     */
    max_price?: number | null;
};

