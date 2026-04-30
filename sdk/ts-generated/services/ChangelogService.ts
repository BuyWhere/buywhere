/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ChangelogResponse } from '../models/ChangelogResponse';
import type { CancelablePromise } from '../core/CancelablePromise';
import type { BaseHttpRequest } from '../core/BaseHttpRequest';
export class ChangelogService {
    constructor(public readonly httpRequest: BaseHttpRequest) {}
    /**
     * Get structured API changelog
     * Returns the parsed release history from `CHANGELOG.md` as JSON.
     * Intended for agent frameworks and SDKs that need to detect API updates programmatically.
     *
     * @returns ChangelogResponse Structured API release history
     * @throws ApiError
     */
    public getApiChangelog(): CancelablePromise<ChangelogResponse> {
        return this.httpRequest.request({
            method: 'GET',
            url: '/v1/changelog',
            errors: {
                400: `Unsupported version requested`,
            },
        });
    }
}
