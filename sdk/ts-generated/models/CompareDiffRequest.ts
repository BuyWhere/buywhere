/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type CompareDiffRequest = {
    /**
     * List of 2-5 product IDs to compare directly
     */
    product_ids: Array<number>;
    /**
     * Include image similarity computation
     */
    include_image_similarity?: boolean;
};

