import { BuyWhereClient } from './client';
import type { Webhook, WebhookCreateResponse } from './types';

export class WebhooksClient {
  constructor(private client: BuyWhereClient) {}

  async create(url: string, events: string[]): Promise<WebhookCreateResponse> {
    return this.client.createWebhook(url, events);
  }

  async list(): Promise<Webhook[]> {
    return this.client.listWebhooks();
  }

  async delete(id: string): Promise<void> {
    await this.client.deleteWebhook(id);
  }
}
