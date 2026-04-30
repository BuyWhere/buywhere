/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CategoryResponse } from '../models/CategoryResponse';
import type { CancelablePromise } from '../core/CancelablePromise';
import type { BaseHttpRequest } from '../core/BaseHttpRequest';
export class CategoriesService {
    constructor(public readonly httpRequest: BaseHttpRequest) {}
    /**
     * List available categories
     * Returns all product categories with active product counts.
     * Sorted by product count descending.
     * Rate limit: 1000 requests/minute per API key.
     *
     * @returns CategoryResponse Category list with product counts
     * @throws ApiError
     */
    public listCategories(): CancelablePromise<CategoryResponse> {
        return this.httpRequest.request({
            method: 'GET',
            url: '/v1/categories',
            errors: {
                401: `Invalid or missing API key`,
                429: `Rate limit exceeded`,
                500: `Internal server error`,
            },
        });
    }
}
