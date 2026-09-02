import { BuyWhereClient } from './client';
import type { CompareParams, CompareResponse, ProductId } from './types';

export class CompareClient {
  constructor(private client: BuyWhereClient) {}

  async compare(params: ProductId[]): Promise<CompareResponse>;
  async compare(params: string | CompareParams): Promise<CompareResponse>;
  async compare(params: ProductId[] | string | CompareParams): Promise<CompareResponse> {
    if (Array.isArray(params)) {
      return this.client.compare(params);
    }

    return this.client.compare(params);
  }

  async compareByCategory(categorySlug: string): Promise<CompareResponse> {
    return this.client.compare({ category: categorySlug, product_ids: [] });
  }

  async compareProducts(productIds: ProductId[]): Promise<CompareResponse> {
    return this.client.compare({ product_ids: productIds });
  }

  async getBestPrices(productIds: ProductId[]): Promise<CompareResponse> {
    return this.client.compare({ product_ids: productIds });
  }
}

export type CompareNamespace = CompareClient & ((productIds: ProductId[]) => Promise<CompareResponse>);

export function createCompareNamespace(client: BuyWhereClient): CompareNamespace {
  const compareClient = new CompareClient(client);
  const callableCompare = ((productIds: ProductId[]) => compareClient.compareProducts(productIds)) as CompareNamespace;
  return Object.assign(callableCompare, compareClient);
}
