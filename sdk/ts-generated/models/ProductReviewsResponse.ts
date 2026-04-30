/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { RatingDistributionBucket } from './RatingDistributionBucket';
import type { ReviewSource } from './ReviewSource';
export type ProductReviewsResponse = {
    /**
     * Product ID
     */
    product_id: number;
    /**
     * Total aggregated review count
     */
    review_count?: number | null;
    /**
     * Aggregated average rating (0-5)
     */
    avg_rating?: number | null;
    /**
     * Primary source of rating data
     */
    rating_source?: string | null;
    /**
     * Sentiment score derived from review text (0-1 scale, higher = more positive)
     */
    sentiment_score?: number | null;
    /**
     * Star rating distribution (1-5 stars)
     */
    rating_distribution?: Array<RatingDistributionBucket>;
    /**
     * Per-source review breakdown
     */
    sources?: Array<ReviewSource>;
};

