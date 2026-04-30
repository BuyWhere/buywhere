/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { IngestProductItem } from './IngestProductItem';
export type IngestRequest = {
    /**
     * Source platform
     */
    source: 'lazada_sg' | 'shopee_sg' | 'carousell' | 'qoo10';
    products: Array<IngestProductItem>;
};

