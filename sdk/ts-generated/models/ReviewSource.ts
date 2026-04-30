/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type ReviewSource = {
    /**
     * Source platform identifier
     */
    source: string;
    /**
     * Number of reviews from this source
     */
    review_count: number;
    /**
     * Average rating from this source (0-5)
     */
    avg_rating: number;
    /**
     * When this review data was last scraped
     */
    last_scraped?: string;
};

