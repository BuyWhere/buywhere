/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { TrendingMatch } from './TrendingMatch';
export type TrendingResponse = {
    /**
     * Category filter used (null if no filter)
     */
    category: string | null;
    items: Array<TrendingMatch>;
    /**
     * Total number of items returned
     */
    total: number;
};

