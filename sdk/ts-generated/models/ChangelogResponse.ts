/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ChangelogRelease } from './ChangelogRelease';
export type ChangelogResponse = {
    /**
     * Current API version emitted in response headers
     */
    api_version: string;
    releases: Array<ChangelogRelease>;
};

