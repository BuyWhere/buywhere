/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type RatingDistributionBucket = {
    /**
     * Star rating (1-5)
     */
    stars: number;
    /**
     * Number of reviews with this star rating
     */
    count: number;
    /**
     * Percentage of total reviews
     */
    percentage?: number;
};

