/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { BaseHttpRequest } from './core/BaseHttpRequest';
import type { OpenAPIConfig } from './core/OpenAPI';
import { FetchHttpRequest } from './core/FetchHttpRequest';
import { CatalogService } from './services/CatalogService';
import { CategoriesService } from './services/CategoriesService';
import { ChangelogService } from './services/ChangelogService';
import { DealsService } from './services/DealsService';
import { IngestService } from './services/IngestService';
import { IngestionService } from './services/IngestionService';
import { ProductsService } from './services/ProductsService';
import { SearchService } from './services/SearchService';
import { StatusService } from './services/StatusService';
import { SystemService } from './services/SystemService';
type HttpRequestConstructor = new (config: OpenAPIConfig) => BaseHttpRequest;
export class BuyWhere {
    public readonly catalog: CatalogService;
    public readonly categories: CategoriesService;
    public readonly changelog: ChangelogService;
    public readonly deals: DealsService;
    public readonly ingest: IngestService;
    public readonly ingestion: IngestionService;
    public readonly products: ProductsService;
    public readonly search: SearchService;
    public readonly status: StatusService;
    public readonly system: SystemService;
    public readonly request: BaseHttpRequest;
    constructor(config?: Partial<OpenAPIConfig>, HttpRequest: HttpRequestConstructor = FetchHttpRequest) {
        this.request = new HttpRequest({
            BASE: config?.BASE ?? 'https://api.buywhere.ai',
            VERSION: config?.VERSION ?? '1.0.0',
            WITH_CREDENTIALS: config?.WITH_CREDENTIALS ?? false,
            CREDENTIALS: config?.CREDENTIALS ?? 'include',
            TOKEN: config?.TOKEN,
            USERNAME: config?.USERNAME,
            PASSWORD: config?.PASSWORD,
            HEADERS: config?.HEADERS,
            ENCODE_PATH: config?.ENCODE_PATH,
        });
        this.catalog = new CatalogService(this.request);
        this.categories = new CategoriesService(this.request);
        this.changelog = new ChangelogService(this.request);
        this.deals = new DealsService(this.request);
        this.ingest = new IngestService(this.request);
        this.ingestion = new IngestionService(this.request);
        this.products = new ProductsService(this.request);
        this.search = new SearchService(this.request);
        this.status = new StatusService(this.request);
        this.system = new SystemService(this.request);
    }
}

