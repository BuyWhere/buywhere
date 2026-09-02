import { BuyWhereClient } from './client';
import type { SearchParams, SearchResponse } from './types';

export class SearchClient {
  constructor(private client: BuyWhereClient) {}

  async search(params: string | SearchParams): Promise<SearchResponse> {
    return this.client.search(params);
  }

  async searchByCategory(
    category: string,
    options: Omit<SearchParams, 'query'> = {}
  ): Promise<SearchResponse> {
    return this.client.search({
      query: category,
      ...options,
    });
  }

  async searchByCountry(
    query: string,
    country: string,
    options: Omit<SearchParams, 'query' | 'country'> = {}
  ): Promise<SearchResponse> {
    return this.client.search({
      query,
      country,
      ...options,
    });
  }

  async searchByRegion(
    query: string,
    region: string,
    options: Omit<SearchParams, 'query' | 'region'> = {}
  ): Promise<SearchResponse> {
    return this.client.search({
      query,
      region,
      ...options,
    });
  }
}
