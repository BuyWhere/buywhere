/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { DuplicateGroup } from './DuplicateGroup';
export type DeduplicationReport = {
    total_products: number;
    products_with_canonical: number;
    duplicate_rate: number;
    duplicate_groups: number;
    sample_duplicates: Array<DuplicateGroup>;
};

