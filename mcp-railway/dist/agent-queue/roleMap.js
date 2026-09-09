"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ROLE_ALLOWLIST = exports.NON_ENGINEERING_ROLES = void 0;
exports.getTaskCategoryFromLabels = getTaskCategoryFromLabels;
exports.inferTaskCategoryFromDescription = inferTaskCategoryFromDescription;
exports.inferEngineeringSubType = inferEngineeringSubType;
exports.NON_ENGINEERING_ROLES = new Set([
    'designer',
    'researcher',
    'cmo',
    'pm',
    'general',
    'ceo',
    'content',
]);
exports.ROLE_ALLOWLIST = {
    engineering: new Set(['engineer', 'qa', 'cto']),
    content: new Set(['content', 'cmo', 'general', 'designer', 'researcher']),
    design: new Set(['designer']),
    research: new Set(['researcher']),
    management: new Set(['ceo', 'cto', 'pm', 'general']),
};
function getTaskCategoryFromLabels(labels) {
    const labelSet = new Set(labels.map(l => l.toLowerCase().trim()));
    const engineeringKeywords = [
        'scraping', 'ci/cd', 'cicd', 'data pipeline', 'api', 'backend',
        'frontend', 'devops', 'platform', 'engineering', 'infrastructure',
        'database', 'migration', 'deployment',
    ];
    if (engineeringKeywords.some(kw => labelSet.has(kw)))
        return 'engineering';
    if (labelSet.has('content') || labelSet.has('writing') || labelSet.has('copywriting') || labelSet.has('seo'))
        return 'content';
    if (labelSet.has('design') || labelSet.has('ui') || labelSet.has('ux'))
        return 'design';
    if (labelSet.has('research'))
        return 'research';
    if (labelSet.has('management') || labelSet.has('planning'))
        return 'management';
    return null;
}
function inferTaskCategoryFromDescription(description) {
    const lower = description.toLowerCase();
    const patterns = [
        [/scraper|scraping|crawl|extract/i, 'engineering'],
        [/api|endpoint|route|middleware|mcp|server/i, 'engineering'],
        [/ci\/cd|ci|cd|deploy|pipeline|github action|workflow/i, 'engineering'],
        [/data pipeline|etl|data lake|data warehouse|migration/i, 'engineering'],
        [/backend|frontend|devops|infrastructure|database|sql|nosql/i, 'engineering'],
        [/copywriting|blog|article|seo content|documentation/i, 'content'],
        [/ui|ux|design|figma|wireframe|prototype/i, 'design'],
        [/research|study|analysis|survey/i, 'research'],
        [/management|strategy|planning|directive|roster|standup/i, 'management'],
    ];
    for (const [regex, category] of patterns) {
        if (regex.test(lower))
            return category;
    }
    return null;
}
function inferEngineeringSubType(description) {
    const lower = description.toLowerCase();
    if (/scraper|scraping|crawl|extract/i.test(lower))
        return 'scraping';
    if (/api|endpoint|mcp|router/i.test(lower))
        return 'api_work';
    if (/ci\/cd|deploy|pipeline|github action/i.test(lower))
        return 'ci_cd';
    if (/data pipeline|etl|migration/i.test(lower))
        return 'data_pipeline';
    if (/backend/i.test(lower))
        return 'backend';
    if (/frontend/i.test(lower))
        return 'frontend';
    if (/devops|infrastructure/i.test(lower))
        return 'devops';
    if (/platform/i.test(lower))
        return 'platform';
    return null;
}
