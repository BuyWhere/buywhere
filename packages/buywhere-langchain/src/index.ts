import { Tool } from '@langchain/core/tools';
import type { SearchParams, Product, DealProduct, ComparisonProduct, MerchantPrice, AgentSearchParams } from '@buywhere/sdk';
import { BuyWhereSDK } from '@buywhere/sdk';

export interface BuyWhereLangChainConfig {
  apiKey: string;
  region?: 'us' | 'sea';
  defaultCountry?: 'SG' | 'MY' | 'TH' | 'PH' | 'VN' | 'ID' | 'US';
}

export class SearchProductsTool extends Tool {
  name = 'search_products';
  description = `Search the BuyWhere product catalog for products matching a query.

Inputs:
- query: string (required) - Search query (e.g., "mechanical keyboard", "iphone 15 case")
- country: string (optional) - Country code: SG, MY, TH, PH, VN, ID, US
- limit: number (optional) - Maximum number of results (default: 5, max: 50)
- price_min: number (optional) - Minimum price filter
- price_max: number (optional) - Maximum price filter

Returns product listings with prices, merchant info, availability, and affiliate links.`;

  private client: InstanceType<typeof BuyWhereSDK>;

  constructor(config: BuyWhereLangChainConfig) {
    super();
    this.client = new BuyWhereSDK(config.apiKey);
  }

  protected async _call(input: string): Promise<string> {
    try {
      const params = JSON.parse(input) as {
        query: string;
        country?: string;
        limit?: number;
        price_min?: number;
        price_max?: number;
      };

      const results = await this.client.search.search({
        query: params.query,
        country: params.country as SearchParams['country'],
        limit: params.limit,
        price_min: params.price_min,
        price_max: params.price_max,
      });

      return JSON.stringify({
        success: true,
        total: results.total,
        products: results.items.map((p: Product) => ({
          id: p.id,
          name: p.name,
          price: p.price,
          currency: p.currency,
          merchant: p.source,
          url: p.buy_url,
          in_stock: p.is_available,
          rating: p.rating,
        })),
      }, null, 2);
    } catch (error) {
      return JSON.stringify({
        success: false,
        error: (error as Error).message,
      });
    }
  }
}

export class ComparePricesTool extends Tool {
  name = 'compare_prices';
  description = `Compare prices for a product across multiple merchants.

Inputs:
- query: string (required) - Product to compare (e.g., "iphone 15", "samsung tv")
- category: string (optional) - Category slug (e.g., "electronics", "fashion")
- limit: number (optional) - Maximum number of results (default: 10)

Returns sorted price listings from cheapest to most expensive across all merchants.`;

  private client: InstanceType<typeof BuyWhereSDK>;

  constructor(config: BuyWhereLangChainConfig) {
    super();
    this.client = new BuyWhereSDK(config.apiKey);
  }

  protected async _call(input: string): Promise<string> {
    try {
      const params = JSON.parse(input) as {
        query: string;
        category?: string;
        limit?: number;
      };

      const results = await this.client.products.comparePrices(params.query, {
        category: params.category,
        limit: params.limit,
      });

      return JSON.stringify({
        success: true,
        products: results.products.map((p: ComparisonProduct) => ({
          id: p.id,
          name: p.name,
          brand: p.brand,
          lowest_price: p.lowest_price,
          lowest_price_merchant: p.lowest_price_merchant,
          all_merchants: p.prices.map((mp: MerchantPrice) => ({
            merchant: mp.merchant,
            price: mp.price,
            currency: mp.currency,
            url: mp.url,
            in_stock: mp.in_stock,
            rating: mp.rating,
            savings_pct: mp.savings_pct,
          })),
        })),
      }, null, 2);
    } catch (error) {
      return JSON.stringify({
        success: false,
        error: (error as Error).message,
      });
    }
  }
}

export class GetDealsTool extends Tool {
  name = 'get_deals';
  description = `Get current deals and price drops from BuyWhere.

Inputs:
- country: string (optional) - Country code: SG, MY, TH, PH, VN, ID, US (default: SG)
- category: string (optional) - Category filter (e.g., "electronics", "fashion")
- limit: number (optional) - Maximum number of deals (default: 10)
- min_discount_pct: number (optional) - Minimum discount percentage filter

Returns products with discounts, original prices, discount percentages, and expiration.`;

  private client: InstanceType<typeof BuyWhereSDK>;

  constructor(config: BuyWhereLangChainConfig) {
    super();
    this.client = new BuyWhereSDK(config.apiKey);
  }

  protected async _call(input: string): Promise<string> {
    try {
      const params = JSON.parse(input) as {
        country?: string;
        category?: string;
        limit?: number;
        min_discount_pct?: number;
      };

      const results = await this.client.deals.getDeals({
        country: params.country as 'SG' | 'MY' | 'TH' | 'PH' | 'VN' | 'ID' | 'US',
        category: params.category,
        limit: params.limit,
      });

      return JSON.stringify({
        success: true,
        total: results.meta.total,
        deals: results.deals.map((d: DealProduct) => ({
          id: d.id,
          name: d.name,
          current_price: d.price,
          original_price: d.original_price,
          discount_pct: d.discount_pct,
          merchant: d.merchant,
          url: d.url,
          expires_at: d.ends_at,
          is_exclusive: d.is_exclusive,
        })),
      }, null, 2);
    } catch (error) {
      return JSON.stringify({
        success: false,
        error: (error as Error).message,
      });
    }
  }
}

export class GetProductDetailsTool extends Tool {
  name = 'get_product_details';
  description = `Get detailed information about a specific product by its ID.

Inputs:
- product_id: number (required) - The unique product ID

Returns full product details including all merchant prices, lowest price, brand, and description.`;

  private client: InstanceType<typeof BuyWhereSDK>;

  constructor(config: BuyWhereLangChainConfig) {
    super();
    this.client = new BuyWhereSDK(config.apiKey);
  }

  protected async _call(input: string): Promise<string> {
    try {
      const params = JSON.parse(input) as { product_id: number };
      const product = await this.client.products.getProduct(params.product_id);

      return JSON.stringify({
        success: true,
        product: {
          id: product.id,
          name: product.name,
          brand: product.brand,
          description: product.description,
          category: product.category,
          lowest_price: product.lowest_price,
          lowest_price_merchant: product.lowest_price_merchant,
          all_merchants: product.prices.map((mp: MerchantPrice) => ({
            merchant: mp.merchant,
            price: mp.price,
            currency: mp.currency,
            url: mp.url,
            in_stock: mp.in_stock,
            rating: mp.rating,
          })),
          rating: product.rating,
          reviews_count: product.reviews_count,
          last_updated: product.last_updated,
        },
      }, null, 2);
    } catch (error) {
      return JSON.stringify({
        success: false,
        error: (error as Error).message,
      });
    }
  }
}

export class GetPriceHistoryTool extends Tool {
  name = 'get_price_history';
  description = `Get historical price data for a product to track price trends.

Inputs:
- product_id: number (required) - The unique product ID
- country: string (optional) - Country code: SG, MY, TH, PH, VN, ID, US (default: SG)
- period: string (optional) - Time period: 7d, 30d, 90d, 1y (default: 30d)

Returns price points over time showing lowest, highest, and average prices.`;

  private client: InstanceType<typeof BuyWhereSDK>;

  constructor(config: BuyWhereLangChainConfig) {
    super();
    this.client = new BuyWhereSDK(config.apiKey);
  }

  protected async _call(input: string): Promise<string> {
    try {
      const params = JSON.parse(input) as {
        product_id: number;
        country?: string;
        period?: '7d' | '30d' | '90d' | '1y';
      };

      const history = await this.client.products.getPriceHistory({
        product_id: params.product_id,
        country: params.country as 'SG' | 'MY' | 'TH' | 'PH' | 'VN' | 'ID' | 'US',
        period: params.period,
      });

      return JSON.stringify({
        success: true,
        product_name: history.product_name,
        period: history.period,
        lowest_price: {
          price: history.lowest_price,
          date: history.lowest_price_date,
        },
        highest_price: {
          price: history.highest_price,
          date: history.highest_price_date,
        },
        average_price: history.average_price,
        price_history: history.price_history.slice(0, 30),
      }, null, 2);
    } catch (error) {
      return JSON.stringify({
        success: false,
        error: (error as Error).message,
      });
    }
  }
}

export class AgentSearchProductsTool extends Tool {
  name = 'agent_search_products';
  description = `Agent-optimized product search using BuyWhere v2 API with natural language processing.

  Inputs:
  - q: string (required) - Natural language search query (e.g., "nike air max shoes size 10")
  - limit: number (optional) - Maximum number of results (default: 10, max: 100)
  - sort_by: string (optional) - Sort order: relevance, price_asc, price_desc, newest, highest_rated, most_reviewed
  - min_price: number (optional) - Minimum price filter
  - max_price: number (optional) - Maximum price filter
  - include_agent_insights: boolean (optional) - Include buybox prediction and competitor analysis
  - include_availability_prediction: boolean (optional) - Include ML-based availability prediction

  Returns enhanced product results with freshness_score, confidence_score, availability_prediction, and optional agent insights. Best for shopping agent workflows.`;

  private client: InstanceType<typeof BuyWhereSDK>;

  constructor(config: BuyWhereLangChainConfig) {
    super();
    this.client = new BuyWhereSDK(config.apiKey);
  }

  protected async _call(input: string): Promise<string> {
    try {
      const params = JSON.parse(input) as {
        q: string;
        limit?: number;
        sort_by?: 'relevance' | 'price_asc' | 'price_desc' | 'newest' | 'highest_rated' | 'most_reviewed';
        min_price?: number;
        max_price?: number;
        include_agent_insights?: boolean;
        include_availability_prediction?: boolean;
      };

      const results = await this.client.agents.search({
        q: params.q,
        limit: params.limit,
        sort_by: params.sort_by,
        min_price: params.min_price,
        max_price: params.max_price,
        include_agent_insights: params.include_agent_insights,
        include_availability_prediction: params.include_availability_prediction,
      } as AgentSearchParams);

      return JSON.stringify({
        success: true,
        total: results.total,
        query_processed: results.query_processed,
        products: results.results.map((p: { id: number; title: string; price: number; currency: string; price_sgd: number; source: string; brand: string; category: string; url: string; image_url: string; rating: number; review_count: number; is_available: boolean; freshness_score: number; confidence_score: number; availability_prediction: string }) => ({
          id: p.id,
          title: p.title,
          price: p.price,
          currency: p.currency,
          price_sgd: p.price_sgd,
          source: p.source,
          brand: p.brand,
          category: p.category,
          url: p.url,
          image_url: p.image_url,
          rating: p.rating,
          review_count: p.review_count,
          is_available: p.is_available,
          freshness_score: p.freshness_score,
          confidence_score: p.confidence_score,
          availability_prediction: p.availability_prediction,
        })),
      }, null, 2);
    } catch (error) {
      return JSON.stringify({
        success: false,
        error: (error as Error).message,
      });
    }
  }
}

export function createBuyWhereTools(config: BuyWhereLangChainConfig) {
  return [
    new SearchProductsTool(config),
    new ComparePricesTool(config),
    new GetDealsTool(config),
    new GetProductDetailsTool(config),
    new GetPriceHistoryTool(config),
    new AgentSearchProductsTool(config),
  ];
}

export class ResolveProductQueryTool extends Tool {
  name = 'resolve_product_query';
  description = `Use this whenever a user asks to find, search, or look up products — especially when they want product recommendations or need to discover options for a shopping decision.

Inputs:
- query: string (required) - Natural language search query (e.g., "mechanical keyboard", "iphone 15 case")
- country: string (optional) - Country code: SG, MY, TH, PH, VN, ID, US (default: SG)
- region: string (optional) - "us" for United States or "sea" for Southeast Asia
- limit: number (optional) - Maximum number of results (default: 10, max: 50)
- price_min: number (optional) - Minimum price filter
- price_max: number (optional) - Maximum price filter
- include_out_of_stock: boolean (optional) - Include out-of-stock products (default: false)

Returns product results with buywhere_score, confidence, availability_status, price_last_checked, and exact_match fields. merchant_reliability_score is pending API support.`;

  private client: InstanceType<typeof BuyWhereSDK>;

  constructor(config: BuyWhereLangChainConfig) {
    super();
    this.client = new BuyWhereSDK(config.apiKey);
  }

  protected async _call(input: string): Promise<string> {
    try {
      const params = JSON.parse(input) as {
        query: string;
        country?: string;
        region?: 'us' | 'sea';
        limit?: number;
        price_min?: number;
        price_max?: number;
        include_out_of_stock?: boolean;
      };

      const results = await this.client.agents.search({
        q: params.query,
        limit: params.limit,
        min_price: params.price_min,
        max_price: params.price_max,
        include_agent_insights: true,
      });

      return JSON.stringify({
        success: true,
        query_processed: results.query_processed,
        total: results.total,
        results: results.results.map((p) => ({
          product_id: p.id,
          title: p.title,
          buywhere_score: {
            score: p.confidence_score * 100,
            rank: results.results.indexOf(p) + 1,
            reason_for_rank: `Matched "${params.query}" with confidence ${p.confidence_score}`,
          },
          confidence: p.confidence_score,
          // merchant_reliability_score: pending API support — source data not yet available
          availability_status: {
            status: p.availability_prediction,
            stock_level: p.stock_level === 'in_stock' ? 100 : p.stock_level === 'low_stock' ? 10 : 0,
          },
          price_last_checked: p.data_freshness,
          exact_match: p.confidence_score > 0.8,
          prices: [{
            merchant: p.source,
            price: p.price,
            currency: p.currency,
            buy_url: p.url,
            affiliate_url: p.affiliate_url,
          }],
        })),
        query_time_ms: results.query_time_ms,
        cache_hit: results.cache_hit,
      }, null, 2);
    } catch (error) {
      return JSON.stringify({
        success: false,
        error: (error as Error).message,
      });
    }
  }
}

export class FindBestPriceTool extends Tool {
  name = 'find_best_price';
  description = `Use this whenever a user asks about prices, wants to find the cheapest option, or asks "what's the best price for X" or "where can I buy X for the lowest price".

Inputs:
- product_name: string (required) - Product name to find best price for (e.g., "iphone 15 pro 256gb")
- category: string (optional) - Category to filter by (e.g., "electronics", "fashion")
- country: string (optional) - Country code: SG, MY, TH, PH, VN, ID, US (default: SG)
- region: string (optional) - "us" for United States or "sea" for Southeast Asia

Returns the best current price across all merchants with buywhere_score, confidence, and price freshness. merchant_reliability_score is pending API support.`;

  private client: InstanceType<typeof BuyWhereSDK>;

  constructor(config: BuyWhereLangChainConfig) {
    super();
    this.client = new BuyWhereSDK(config.apiKey);
  }

  protected async _call(input: string): Promise<string> {
    try {
      const params = JSON.parse(input) as {
        product_name: string;
        category?: string;
        country?: string;
        region?: 'us' | 'sea';
      };

      const results = await this.client.agents.search({
        q: params.product_name,
        limit: 10,
        sort_by: 'price_asc',
      });

      if (!results.results.length) {
        return JSON.stringify({
          success: false,
          error: 'No products found',
        });
      }

      const best = results.results[0];
      const allPrices = results.results.map((p) => ({
        merchant: p.source,
        price: p.price,
        currency: p.currency,
        price_diff: p.price - best.price,
        savings_pct: Math.round(((p.price - best.price) / p.price) * 100),
      }));

      return JSON.stringify({
        success: true,
        product_name: params.product_name,
        best_price: {
          merchant: best.source,
          price: best.price,
          currency: best.currency,
          buy_url: best.url,
          affiliate_url: best.affiliate_url,
        },
        all_prices: allPrices,
        buywhere_score: {
          score: best.confidence_score * 100,
          rank: 1,
          reason_for_rank: `Lowest price for "${params.product_name}" among ${results.results.length} merchants`,
        },
        confidence: best.confidence_score,
        // merchant_reliability_score: pending API support — source data not yet available
        price_last_checked: best.data_freshness,
        exact_match: best.confidence_score > 0.8,
      }, null, 2);
    } catch (error) {
      return JSON.stringify({
        success: false,
        error: (error as Error).message,
      });
    }
  }
}

export class CompareProductsTool extends Tool {
  name = 'compare_products';
  description = `Use this whenever a user wants to compare multiple products, see side-by-side price comparisons, or understand the differences between product options.

Inputs:
- product_ids: array of integers (optional) - Specific product IDs to compare
- category: string (optional) - Category slug to filter products (e.g., "electronics", "fashion")
- country: string (optional) - Country code: SG, MY, TH, PH, VN, ID, US (default: SG)
- limit: number (optional) - Maximum number of products to compare (default: 10, max: 50)

Returns products sorted by price with all merchant listings, including buywhere_score, confidence, availability_status, and exact_match for each product. merchant_reliability_score is pending API support.`;

  private client: InstanceType<typeof BuyWhereSDK>;

  constructor(config: BuyWhereLangChainConfig) {
    super();
    this.client = new BuyWhereSDK(config.apiKey);
  }

  protected async _call(input: string): Promise<string> {
    try {
      const params = JSON.parse(input) as {
        product_ids?: number[];
        category?: string;
        country?: string;
        limit?: number;
      };

      let results;
      if (params.product_ids?.length) {
        results = await Promise.all(
          params.product_ids.map((id) => this.client.products.getProduct(id))
        );
      } else {
        const searchResults = await this.client.agents.search({
          q: params.category || 'products',
          limit: params.limit || 10,
        });
        results = await Promise.all(
          searchResults.results.slice(0, params.limit || 10).map((p) => this.client.products.getProduct(p.id))
        );
      }

      return JSON.stringify({
        success: true,
        products: results.map((p, idx) => ({
          id: p.id,
          name: p.name,
          brand: p.brand,
          buywhere_score: {
            score: (p.rating ?? 0) * 20,
            rank: idx + 1,
            reason_for_rank: `Product comparison rank ${idx + 1}`,
          },
          confidence: (p.rating ?? 0) / 5,
          // merchant_reliability_score: pending API support — not returned by /v1/products/{id}
          availability_status: {
            status: p.prices.some((mp: MerchantPrice) => mp.in_stock) ? 'in_stock' : 'out_of_stock',
          },
          price_last_checked: p.last_updated,
          exact_match: true,
          prices: p.prices,
          lowest_price: p.lowest_price,
          lowest_price_merchant: p.lowest_price_merchant,
        })),
        meta: {
          total_products: results.length,
          total_merchants: new Set(results.flatMap((p) => p.prices.map((mp: MerchantPrice) => mp.merchant))).size,
          last_updated: new Date().toISOString(),
        },
      }, null, 2);
    } catch (error) {
      return JSON.stringify({
        success: false,
        error: (error as Error).message,
      });
    }
  }
}

export class GetProductDetailsV2Tool extends Tool {
  name = 'get_product_details_v2';
  description = `Use this whenever a user wants detailed information about a specific product, needs to see all available prices from different merchants, or wants to see product reviews and price history.

Inputs:
- product_id: number (required) - The unique product ID
- country: string (optional) - Country code: SG, MY, TH, PH, VN, ID, US (default: SG)
- include_reviews: boolean (optional) - Include review summary (default: false)
- include_price_history: boolean (optional) - Include price history (default: false)

Returns full product details with buywhere_score, confidence, availability_status, price_last_checked, and exact_match, plus optional reviews and price history. merchant_reliability_score is pending API support.`;

  private client: InstanceType<typeof BuyWhereSDK>;

  constructor(config: BuyWhereLangChainConfig) {
    super();
    this.client = new BuyWhereSDK(config.apiKey);
  }

  protected async _call(input: string): Promise<string> {
    try {
      const params = JSON.parse(input) as {
        product_id: number;
        country?: string;
        include_reviews?: boolean;
        include_price_history?: boolean;
      };

      const product = await this.client.products.getProduct(params.product_id);

      const result: Record<string, unknown> = {
        success: true,
        product: {
          id: product.id,
          name: product.name,
          brand: product.brand,
          description: product.description,
          category: product.category,
          buywhere_score: {
            score: (product.rating ?? 0) * 20,
            rank: 1,
            reason_for_rank: `Detailed view for product ${product.id}`,
          },
          confidence: (product.rating ?? 0) / 5,
          // merchant_reliability_score: pending API support — not returned by /v1/products/{id}
          availability_status: {
            status: product.prices.some((mp: MerchantPrice) => mp.in_stock) ? 'in_stock' : 'out_of_stock',
          },
          price_last_checked: product.last_updated,
          exact_match: true,
          prices: product.prices,
          lowest_price: product.lowest_price,
          lowest_price_merchant: product.lowest_price_merchant,
          image_url: product.image_url,
          rating: product.rating,
          reviews_count: product.reviews_count,
          last_updated: product.last_updated,
        },
      };

      return JSON.stringify(result, null, 2);
    } catch (error) {
      return JSON.stringify({
        success: false,
        error: (error as Error).message,
      });
    }
  }
}

export class GetPurchaseOptionsTool extends Tool {
  name = 'get_purchase_options';
  description = `Use this whenever a user is ready to buy and wants to see all purchase options, needs merchant choices for a product, or wants to compare fulfillment ratings and reliability across merchants.

Inputs:
- product_id: number (required) - The unique product ID
- country: string (optional) - Country code: SG, MY, TH, PH, VN, ID, US (default: SG)
- filter_merchant: string (optional) - Filter to a specific merchant
- filter_price_min: number (optional) - Minimum price filter
- filter_price_max: number (optional) - Maximum price filter
- sort_by: string (optional) - Sort order: price_asc, price_desc, reliability, rating (default: price_asc)

Returns all merchants with pricing, sorted by the specified criteria, with buywhere_score and recommended merchant. merchant_reliability_score is pending API support.`;

  private client: InstanceType<typeof BuyWhereSDK>;

  constructor(config: BuyWhereLangChainConfig) {
    super();
    this.client = new BuyWhereSDK(config.apiKey);
  }

  protected async _call(input: string): Promise<string> {
    try {
      const params = JSON.parse(input) as {
        product_id: number;
        country?: string;
        filter_merchant?: string;
        filter_price_min?: number;
        filter_price_max?: number;
        sort_by?: 'price_asc' | 'price_desc' | 'reliability' | 'rating';
      };

      const product = await this.client.products.getProduct(params.product_id);

      let options = product.prices.map((mp: MerchantPrice) => ({
        merchant: mp.merchant,
        price: parseFloat(mp.price),
        currency: mp.currency,
        buy_url: mp.url,
        in_stock: mp.in_stock,
        // merchant_reliability_score: pending API support — not returned by /v1/products/{id}
        availability_status: {
          status: mp.in_stock ? 'in_stock' : 'out_of_stock',
        },
        price_last_checked: mp.last_updated,
        rating: mp.rating,
        fulfillment_rating: mp.rating,
      }));

      if (params.filter_merchant) {
        options = options.filter((o) => o.merchant.toLowerCase().includes(params.filter_merchant!.toLowerCase()));
      }
      if (params.filter_price_min !== undefined) {
        options = options.filter((o) => o.price >= params.filter_price_min!);
      }
      if (params.filter_price_max !== undefined) {
        options = options.filter((o) => o.price <= params.filter_price_max!);
      }

      if (params.sort_by === 'price_asc') {
        options.sort((a, b) => a.price - b.price);
      } else if (params.sort_by === 'price_desc') {
        options.sort((a, b) => b.price - a.price);
      }

      return JSON.stringify({
        success: true,
        product_id: params.product_id,
        product_name: product.name,
        buywhere_score: {
          score: (product.rating ?? 0) * 20,
          rank: 1,
          reason_for_rank: `Purchase options for ${product.name}`,
        },
        confidence: (product.rating ?? 0) / 5,
        options,
        recommended_merchant: options[0]?.merchant,
        recommended_buy_url: options[0]?.buy_url,
      }, null, 2);
    } catch (error) {
      return JSON.stringify({
        success: false,
        error: (error as Error).message,
      });
    }
  }
}

export function createAgentTools(config: BuyWhereLangChainConfig) {
  return [
    new ResolveProductQueryTool(config),
    new FindBestPriceTool(config),
    new CompareProductsTool(config),
    new GetProductDetailsTool(config),
    new GetPurchaseOptionsTool(config),
  ];
}