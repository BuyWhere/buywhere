/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type IngestProductItem = {
    /**
     * Unique product SKU within the source
     */
    sku: string;
    /**
     * Merchant/platform shop identifier
     */
    merchant_id: string;
    /**
     * Product title/name
     */
    title: string;
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
    currency?: string;
    /**
     * Direct product URL
     */
    url: string;
    /**
     * Product image URL
     */
    image_url?: string | null;
    /**
     * Primary category
     */
    category?: string | null;
    /**
     * Category hierarchy
     */
    category_path?: Array<string> | null;
    /**
     * Brand name
     */
    brand?: string | null;
    /**
     * Whether product is active/listed
     */
    is_active?: boolean;
    /**
     * Whether product is in stock and available for purchase (null=infer from in_stock)
     */
    is_available?: boolean | null;
    /**
     * Timestamp when availability was last checked
     */
    last_checked?: string | null;
    /**
     * Whether product is currently in stock
     */
    in_stock?: boolean | null;
    /**
     * Raw availability string (in_stock, out_of_stock, pre_order, etc.)
     */
    availability?: string | null;
    /**
     * Additional product metadata
     */
    metadata?: Record<string, any> | null;
};

