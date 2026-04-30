import { BuyWhereClient } from './client';
import { CircuitBreakerError } from './circuit-breaker';
import type { AgentSearchParams, AgentSearchResponse } from './types';

export class AgentsClient {
  constructor(private client: BuyWhereClient) {}

  async search(params: string | AgentSearchParams): Promise<AgentSearchResponse> {
    const searchParams = typeof params === 'string'
      ? { q: params }
      : params;

    const query = new URLSearchParams();
    query.set('q', searchParams.q);

    if (searchParams.limit !== undefined) {
      query.set('limit', String(searchParams.limit));
    }

    if (searchParams.offset !== undefined) {
      query.set('offset', String(searchParams.offset));
    }

    if (searchParams.cursor) {
      query.set('cursor', searchParams.cursor);
    }

    if (searchParams.source) {
      query.set('source', searchParams.source);
    }

    if (searchParams.platform) {
      query.set('platform', searchParams.platform);
    }

    const priceMin = searchParams.min_price ?? searchParams.price_min;
    if (priceMin !== undefined) {
      query.set('price_min', String(priceMin));
    }

    const priceMax = searchParams.max_price ?? searchParams.price_max;
    if (priceMax !== undefined) {
      query.set('price_max', String(priceMax));
    }

    if (searchParams.availability !== undefined) {
      query.set('availability', String(searchParams.availability));
    }

    if (searchParams.sort_by) {
      query.set('sort_by', searchParams.sort_by);
    }

    if (searchParams.currency) {
      query.set('currency', searchParams.currency);
    }

    if (searchParams.include_agent_insights) {
      query.set('include_agent_insights', 'true');
    }

    if (searchParams.include_price_history) {
      query.set('include_price_history', 'true');
    }

    if (searchParams.include_availability_prediction) {
      query.set('include_availability_prediction', 'true');
    }

    const circuitBreaker = this.client.getCircuitBreaker();
    const ftsQuery = new URLSearchParams(query);
    ftsQuery.set('mode', 'fts');

    const semanticUrl = `/v2/agents/search?${query.toString()}`;
    const ftsUrl = `/v1/search?${ftsQuery.toString()}`;

    try {
      return await circuitBreaker.execute(() =>
        this.client.request<AgentSearchResponse>(semanticUrl)
      );
    } catch (error) {
      if (error instanceof CircuitBreakerError) {
        console.log(`[CircuitBreaker] State=${circuitBreaker.getState()} — falling back to FTS search`);
        const response = await this.client.request<AgentSearchResponse>(ftsUrl);
        Object.defineProperty(response, '_searchMode', {
          value: 'fallback',
          writable: false,
        });
        return response;
      }
      throw error;
    }
  }
}