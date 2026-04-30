/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CancelablePromise } from '../core/CancelablePromise';
import type { BaseHttpRequest } from '../core/BaseHttpRequest';
export class SystemService {
    constructor(public readonly httpRequest: BaseHttpRequest) {}
    /**
     * Health check
     * @returns any Service is healthy
     * @throws ApiError
     */
    public healthCheck(): CancelablePromise<{
        status?: string;
        version?: string;
        environment?: string;
    }> {
        return this.httpRequest.request({
            method: 'GET',
            url: '/health',
        });
    }
    /**
     * API root with endpoint listing
     * @returns any API root information
     * @throws ApiError
     */
    public apiRoot(): CancelablePromise<{
        api?: string;
        version?: string;
        endpoints?: Record<string, string>;
        auth?: string;
        docs?: string;
    }> {
        return this.httpRequest.request({
            method: 'GET',
            url: '/v1',
        });
    }
}
