import { BuyWhereClient } from './client';

export interface AutocompleteSuggestion {
  id: number;
  name: string;
  price: number | null;
  currency: string;
  source: string;
  brand: string | null;
  image_url: string | null;
}

export interface AutocompleteResult {
  items: AutocompleteSuggestion[];
  query: string;
}

export interface AutocompleteOptions {
  limit?: number;
  country?: string;
  region?: string;
  currency?: string;
}

export class AutocompleteClient {
  private debounceTimeout: ReturnType<typeof setTimeout> | null = null;
  private abortController: AbortController | null = null;

  constructor(private client: BuyWhereClient) {}

  async autocomplete(
    query: string,
    options: AutocompleteOptions = {}
  ): Promise<AutocompleteResult> {
    if (!query.trim()) {
      return { items: [], query };
    }

    this.cancelPendingRequest();

    const limit = options.limit ?? 8;
    const params = new URLSearchParams();
    params.set('q', query);
    params.set('limit', String(limit));

    if (options.country) {
      params.set('country', options.country);
    }

    if (options.region) {
      params.set('region', options.region);
    }

    if (options.currency) {
      params.set('currency', options.currency);
    }

    // No dedicated /v1/autocomplete or /api/v1/search endpoint exists on prod (all 404).
    // Reuse the main search endpoint and map the results to autocomplete shape.
    const response = await this.client.request<{ results: Array<{
      id: string; title: string; price: { amount: number | null; currency: string };
      merchant: string; image_url: string | null; metadata?: Record<string, unknown> | null;
    }> }>(`/v1/products/search?${params.toString()}`);

    return {
      items: (response.results ?? []).map((p) => ({
        id: typeof p.id === 'string' ? parseInt(p.id, 10) : p.id,
        name: p.title,
        price: p.price?.amount ?? null,
        currency: p.price?.currency ?? 'SGD',
        source: p.merchant,
        brand: (p.metadata as Record<string, unknown> | null | undefined)?.brand as string | null ?? null,
        image_url: p.image_url,
      })),
      query,
    };
  }

  debouncedAutocomplete(
    query: string,
    delay: number,
    options: AutocompleteOptions = {}
  ): Promise<AutocompleteResult> {
    return new Promise((resolve, reject) => {
      if (this.debounceTimeout) {
        clearTimeout(this.debounceTimeout);
      }

      this.debounceTimeout = setTimeout(async () => {
        try {
          const result = await this.autocomplete(query, options);
          resolve(result);
        } catch (error) {
          reject(error);
        }
      }, delay);
    });
  }

  cancelPendingRequest(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    if (this.debounceTimeout) {
      clearTimeout(this.debounceTimeout);
      this.debounceTimeout = null;
    }
  }

  destroy(): void {
    this.cancelPendingRequest();
  }
}