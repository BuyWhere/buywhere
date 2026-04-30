/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type CategoryNode = {
    /**
     * Category name
     */
    name: string;
    /**
     * Number of active products in this category
     */
    count: number;
    children?: Array<CategoryNode>;
};

