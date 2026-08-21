import { BuyWhereClient } from './client';
import type { DealsParams, DealsResponse, DealsFeedParams, DealsFeedResponse } from './types';

export class DealsClient {
  constructor(private client: BuyWhereClient) {}

  async getDeals(params?: DealsParams): Promise<DealsResponse> {
    return this.client.deals(params);
  }

  async getDealsByCountry(
    country: string,
    options: Omit<DealsParams, 'country'> = {}
  ): Promise<DealsResponse> {
    return this.client.deals({ country, ...options });
  }

  async getDealsByCategory(
    category: string,
    options: Omit<DealsParams, 'category'> = {}
  ): Promise<DealsResponse> {
    return this.client.deals({ category, ...options });
  }

  async getDealsFeed(params?: DealsFeedParams): Promise<DealsFeedResponse> {
    return this.client.getDealsFeed(params);
  }
}
