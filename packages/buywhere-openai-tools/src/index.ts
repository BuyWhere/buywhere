export const BuyWhereTools = [
  {
    type: 'function' as const,
    function: {
      name: 'search_products',
      description: 'Search the BuyWhere product catalog by keyword, price range, platform, region, and country. Returns product listings with prices, merchant info, and availability.',
      parameters: {
        type: 'object',
        properties: {
          q: { type: 'string', description: 'Keyword search query (e.g. "wireless headphones", "iphone 15 case")' },
          country_code: { type: 'string', enum: ['SG', 'US', 'VN', 'TH', 'MY', 'ID', 'PH'], description: 'ISO country code (default: SG)' },
          domain: { type: 'string', description: 'Filter by merchant platform (e.g. lazada, shopee)' },
          min_price: { type: 'number', description: 'Minimum price in the active currency' },
          max_price: { type: 'number', description: 'Maximum price in the active currency' },
          currency: { type: 'string', default: 'SGD', description: 'Currency for price filters' },
          limit: { type: 'integer', default: 20, maximum: 100, description: 'Maximum results to return' },
          offset: { type: 'integer', default: 0, description: 'Offset for pagination' },
          compact: { type: 'boolean', default: false, description: 'Return minimal payload for AI agents' },
        },
        required: ['q'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_product',
      description: 'Get full product details and current price by product ID. Includes brand, category, ratings, merchant info, and specifications.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid', description: 'The unique product ID' },
          currency: { type: 'string', default: 'SGD', description: 'Currency for price display' },
        },
        required: ['id'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'compare_products',
      description: 'Compare 2-10 products side-by-side across merchants: price, brand, rating, category path, and merchant. For AI agent price comparison shopping.',
      parameters: {
        type: 'object',
        properties: {
          ids: { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 10, description: 'Product IDs to compare (2-10)' },
        },
        required: ['ids'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_deals',
      description: 'Get discounted products sorted by discount percentage across all merchants. Returns original price, current price, and discount percentage.',
      parameters: {
        type: 'object',
        properties: {
          country_code: { type: 'string', enum: ['SG', 'US', 'VN', 'TH', 'MY', 'ID', 'PH'], description: 'ISO country code' },
          min_discount: { type: 'number', default: 10, description: 'Minimum discount percentage (0-90)' },
          currency: { type: 'string', default: 'SGD', description: 'Currency for price display' },
          limit: { type: 'integer', default: 20, maximum: 100, description: 'Maximum deals to return' },
          offset: { type: 'integer', default: 0, description: 'Offset for pagination' },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'list_categories',
      description: 'List top-level product categories available in the BuyWhere catalog with slugs, names, and product counts.',
      parameters: {
        type: 'object',
        properties: {
          currency: { type: 'string', default: 'SGD', description: 'Currency for product counts' },
        },
      },
    },
  },
] as const;

export type BuyWhereToolName = (typeof BuyWhereTools)[number]['function']['name'];

export interface BuyWhereClientConfig {
  apiKey: string;
  baseUrl?: string;
  timeout?: number;
}

export class BuyWhereClient {
  private apiKey: string;
  private baseUrl: string;
  private timeout: number;

  constructor(config: string | BuyWhereClientConfig) {
    if (typeof config === 'string') {
      this.apiKey = config;
      this.baseUrl = 'https://api.buywhere.ai';
      this.timeout = 30000;
    } else {
      this.apiKey = config.apiKey;
      this.baseUrl = config.baseUrl ?? 'https://api.buywhere.ai';
      this.timeout = config.timeout ?? 30000;
    }
  }

  async dispatch(toolCall: { function: { name: string; arguments: string } }): Promise<unknown> {
    const { name, arguments: argsStr } = toolCall.function;
    const args = JSON.parse(argsStr);

    switch (name as BuyWhereToolName) {
      case 'search_products':
        return this.searchProducts(args);
      case 'get_product':
        return this.getProduct(args.id);
      case 'compare_products':
        return this.compareProducts(args.ids);
      case 'get_deals':
        return this.getDeals(args);
      case 'list_categories':
        return this.listCategories(args);
      default:
        throw new Error(`Unknown function: ${name}`);
    }
  }

  async searchProducts(params: Record<string, unknown>): Promise<unknown> {
    const query = new URLSearchParams();
    if (params.q) query.set('q', params.q as string);
    if (params.country_code) query.set('country_code', params.country_code as string);
    if (params.domain) query.set('domain', params.domain as string);
    if (params.currency) query.set('currency', params.currency as string);
    if (params.min_price !== undefined) query.set('min_price', String(params.min_price));
    if (params.max_price !== undefined) query.set('max_price', String(params.max_price));
    if (params.limit !== undefined) query.set('limit', String(params.limit));
    if (params.offset !== undefined) query.set('offset', String(params.offset));
    if (params.compact !== undefined) query.set('compact', String(params.compact));
    return this.request(`/v1/products/search?${query.toString()}`);
  }

  async getProduct(id: string): Promise<unknown> {
    return this.request(`/v1/products/${id}`);
  }

  async compareProducts(ids: string[]): Promise<unknown> {
    return this.request(`/v1/products/compare?ids=${ids.join(',')}`);
  }

  async getDeals(params: Record<string, unknown>): Promise<unknown> {
    const query = new URLSearchParams();
    if (params.country_code) query.set('country_code', params.country_code as string);
    if (params.currency) query.set('currency', params.currency as string);
    if (params.min_discount !== undefined) query.set('min_discount', String(params.min_discount));
    if (params.limit !== undefined) query.set('limit', String(params.limit));
    if (params.offset !== undefined) query.set('offset', String(params.offset));
    return this.request(`/v1/products/deals?${query.toString()}`);
  }

  async listCategories(params: Record<string, unknown>): Promise<unknown> {
    const query = new URLSearchParams();
    if (params.currency) query.set('currency', params.currency as string);
    return this.request(`/v1/categories?${query.toString()}`);
  }

  private async request(path: string, attempt = 1): Promise<unknown> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      const shouldRetry = (response.status === 429 || response.status >= 500) && attempt < 3;
      if (shouldRetry) {
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 8000);
        await new Promise(resolve => setTimeout(resolve, delay));
        return this.request(path, attempt + 1);
      }
      throw new Error(`BuyWhere API error: ${response.status} ${response.statusText}${body ? ` — ${body}` : ''}`);
    }

    return response.json();
  }
}
