import { Tool, DynamicStructuredTool } from '@langchain/core/tools';

interface BuyWhereLangChainConfig {
    apiKey: string;
    region?: 'us' | 'sea';
    defaultCountry?: 'SG' | 'MY' | 'TH' | 'PH' | 'VN' | 'ID' | 'US';
}
declare class SearchProductsTool extends Tool {
    name: string;
    description: string;
    private client;
    constructor(config: BuyWhereLangChainConfig);
    protected _call(input: string): Promise<string>;
}
declare class ComparePricesTool extends Tool {
    name: string;
    description: string;
    private client;
    constructor(config: BuyWhereLangChainConfig);
    protected _call(input: string): Promise<string>;
}
declare class GetDealsTool extends Tool {
    name: string;
    description: string;
    private client;
    constructor(config: BuyWhereLangChainConfig);
    protected _call(input: string): Promise<string>;
}
declare class GetProductDetailsTool extends Tool {
    name: string;
    description: string;
    private client;
    constructor(config: BuyWhereLangChainConfig);
    protected _call(input: string): Promise<string>;
}
declare class GetPriceHistoryTool extends Tool {
    name: string;
    description: string;
    private client;
    constructor(config: BuyWhereLangChainConfig);
    protected _call(input: string): Promise<string>;
}
declare class AgentSearchProductsTool extends Tool {
    name: string;
    description: string;
    private client;
    constructor(config: BuyWhereLangChainConfig);
    protected _call(input: string): Promise<string>;
}
declare function createBuyWhereTools(config: BuyWhereLangChainConfig): (SearchProductsTool | ComparePricesTool | GetDealsTool | GetProductDetailsTool | GetPriceHistoryTool | AgentSearchProductsTool)[];
declare class ResolveProductQueryTool extends Tool {
    name: string;
    description: string;
    private client;
    constructor(config: BuyWhereLangChainConfig);
    protected _call(input: string): Promise<string>;
}
declare class FindBestPriceTool extends Tool {
    name: string;
    description: string;
    private client;
    constructor(config: BuyWhereLangChainConfig);
    protected _call(input: string): Promise<string>;
}
declare class CompareProductsTool extends Tool {
    name: string;
    description: string;
    private client;
    constructor(config: BuyWhereLangChainConfig);
    protected _call(input: string): Promise<string>;
}
declare class GetProductDetailsV2Tool extends Tool {
    name: string;
    description: string;
    private client;
    constructor(config: BuyWhereLangChainConfig);
    protected _call(input: string): Promise<string>;
}
declare class GetPurchaseOptionsTool extends Tool {
    name: string;
    description: string;
    private client;
    constructor(config: BuyWhereLangChainConfig);
    protected _call(input: string): Promise<string>;
}
declare function createAgentTools(config: BuyWhereLangChainConfig): (GetProductDetailsTool | ResolveProductQueryTool | FindBestPriceTool | CompareProductsTool | GetPurchaseOptionsTool)[];
/**
 * search_products — DynamicStructuredTool variant with Zod schema validation.
 * Accepts typed inputs instead of a raw JSON string.
 */
declare function createSearchProductsTool(config: BuyWhereLangChainConfig): DynamicStructuredTool;
/**
 * get_product_details — DynamicStructuredTool variant.
 */
declare function createGetProductDetailsTool(config: BuyWhereLangChainConfig): DynamicStructuredTool;
/**
 * get_price_comparison — DynamicStructuredTool variant.
 * Compares prices for a product query across all merchants.
 */
declare function createGetPriceComparisonTool(config: BuyWhereLangChainConfig): DynamicStructuredTool;
/**
 * Factory that returns the three spec-required DynamicStructuredTools.
 * Use this for new LangChain.js agent integrations.
 */
declare function createStructuredTools(config: BuyWhereLangChainConfig): DynamicStructuredTool[];

export { AgentSearchProductsTool, type BuyWhereLangChainConfig, ComparePricesTool, CompareProductsTool, FindBestPriceTool, GetDealsTool, GetPriceHistoryTool, GetProductDetailsTool, GetProductDetailsV2Tool, GetPurchaseOptionsTool, ResolveProductQueryTool, SearchProductsTool, createAgentTools, createBuyWhereTools, createGetPriceComparisonTool, createGetProductDetailsTool, createSearchProductsTool, createStructuredTools };
