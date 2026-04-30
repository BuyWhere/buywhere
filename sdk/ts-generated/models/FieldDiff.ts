/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type FieldDiff = {
    /**
     * Field name that differs
     */
    field: string;
    /**
     * Value per product in order provided
     */
    values: Array<string>;
    /**
     * True if all products have the same value for this field
     */
    all_identical: boolean;
};

