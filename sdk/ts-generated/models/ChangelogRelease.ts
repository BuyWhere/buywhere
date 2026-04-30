/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ChangelogChange } from './ChangelogChange';
export type ChangelogRelease = {
    /**
     * Semantic API release version
     */
    version: string;
    /**
     * Release date in ISO-8601 format
     */
    date: string;
    changes: Array<ChangelogChange>;
};

