/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { IngestionRunInfo } from './IngestionRunInfo';
import type { PlatformProductCount } from './PlatformProductCount';
export type CatalogStatus = {
    /**
     * Total number of unique active products
     */
    total_unique_products: number;
    platforms: Array<PlatformProductCount>;
    ingestion_runs: Array<IngestionRunInfo>;
    /**
     * Goal in millions of products
     */
    goal_million: number;
    /**
     * Progress toward goal percentage
     */
    progress_percent: number;
};

