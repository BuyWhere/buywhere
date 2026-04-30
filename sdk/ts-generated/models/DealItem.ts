/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type DealItem = {
    /**
     * Unique product ID
     */
    id: number;
    /**
     * Product title
     */
    name: string;
    /**
     * Current price
     */
    price: number;
    /**
     * Original/historical price
     */
    original_price?: number | null;
    /**
     * Discount percentage
     */
    discount_pct?: number | null;
    /**
     * Currency code
     */
    currency: string;
    /**
     * Source platform
     */
    source: string;
    /**
     * Primary category name
     */
    category?: string | null;
    /**
     * Direct purchase URL
     */
    buy_url: string;
    /**
     * Tracked affiliate URL
     */
    affiliate_url?: string | null;
    /**
     * Product image URL
     */
    image_url?: string | null;
    /**
     * Additional product metadata
     */
    metadata?: Record<string, any> | null;
};

