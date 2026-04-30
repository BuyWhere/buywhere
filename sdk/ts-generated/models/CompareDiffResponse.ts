/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CompareDiffEntry } from './CompareDiffEntry';
import type { FieldDiff } from './FieldDiff';
export type CompareDiffResponse = {
    products: Array<CompareDiffEntry>;
    /**
     * Fields that differ across products
     */
    field_diffs: Array<FieldDiff>;
    /**
     * Fields that are identical across all products
     */
    identical_fields: Array<string>;
    /**
     * ID of the cheapest product
     */
    cheapest_product_id: number;
    /**
     * ID of the most expensive product
     */
    most_expensive_product_id: number;
    /**
     * Price difference between cheapest and most expensive
     */
    price_spread: number;
    /**
     * Price spread as percentage of cheapest price
     */
    price_spread_pct: number;
};

