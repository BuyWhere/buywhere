/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type TrendingMatch = {
    /**
     * Unique product ID
     */
    id: number;
    /**
     * Unique product identifier within the source
     */
    sku: string;
    /**
     * Source platform
     */
    source: 'lazada_sg' | 'shopee_sg' | 'carousell' | 'qoo10';
    /**
     * Merchant/platform shop identifier
     */
    merchant_id: string;
    /**
     * Product title
     */
    name: string;
    /**
     * Product description
     */
    description?: string | null;
    /**
     * Product price
     */
    price: number;
    /**
     * Currency code
     */
    currency: string;
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
     * Primary category name
     */
    category?: string | null;
    /**
     * Category hierarchy from root to leaf
     */
    category_path?: Array<string> | null;
    /**
     * Whether product is currently active/available
     */
    is_available: boolean;
    /**
     * Additional product metadata
     */
    metadata?: Record<string, any> | null;
    /**
     * Last update timestamp
     */
    updated_at: string;
};

