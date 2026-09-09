import { BuyWhereClient } from './client';
import type { ProductDetail, CompareParams, CompareResponse, GetPriceHistoryParams, PriceHistoryResponse, GetProductReviewsParams, ReviewSummary, GetProductAlertsParams, ProductAlert, Region } from './types';

export class ProductsClient {
  constructor(private client: BuyWhereClient) {}

  async getProduct(productId: number): Promise<ProductDetail> {
    return this.client.getProduct(productId);
  }

  async comparePrices(
    query: string,
    options?: { category?: string; limit?: number; region?: string; country?: string }
  ): Promise<CompareResponse> {
    const params: CompareParams = {
      product_ids: [],
      category: options?.category,
      region: options?.region as Region | undefined,
      country: options?.country as 'SG' | 'MY' | 'TH' | 'PH' | 'VN' | 'ID' | 'US' | undefined,
    };
    return this.client.compare(params);
  }

  async compareProducts(productIds: number[]): Promise<CompareResponse> {
    return this.client.compare({ product_ids: productIds });
  }

  async getPriceHistory(params: GetPriceHistoryParams): Promise<PriceHistoryResponse> {
    return this.client.getPriceHistory(params);
  }

  async getReviewsSummary(params: GetProductReviewsParams): Promise<ReviewSummary> {
    return this.client.getProductReviewsSummary(params);
  }

  async getAlerts(params: GetProductAlertsParams): Promise<ProductAlert[]> {
    return this.client.getProductAlerts(params);
  }
}