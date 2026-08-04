"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const roleGuard_1 = require("./roleGuard");
const engineer = { id: '1', name: 'TestEngineer', role: 'engineer', capabilities: 'Backend API, scraping infrastructure' };
const designer = { id: '2', name: 'TestDesigner', role: 'designer', capabilities: 'Visual design, brand identity' };
const researcher = { id: '3', name: 'TestResearcher', role: 'researcher', capabilities: 'Market research, analysis' };
const content = { id: '4', name: 'TestContent', role: 'content', capabilities: 'Copywriting, blog posts' };
const general = { id: '5', name: 'TestGeneral', role: 'general', capabilities: 'Business development' };
const cmo = { id: '6', name: 'TestCmo', role: 'cmo', capabilities: 'Marketing strategy' };
const pm = { id: '7', name: 'TestPm', role: 'pm', capabilities: 'Product management' };
const qa = { id: '8', name: 'TestQa', role: 'qa', capabilities: 'Testing and QA' };
const cto = { id: '9', name: 'TestCto', role: 'cto', capabilities: 'Technical leadership' };
const ceo = { id: '10', name: 'TestCeo', role: 'ceo', capabilities: 'Executive leadership' };
const scrapingTask = { description: 'Build product scraper for merchant X', labels: ['scraping'] };
const apiTask = { description: 'Implement paginated product listing API endpoint' };
const deploymentTask = { description: 'Set up CI/CD pipeline with GitHub Actions and staging deployment' };
const dataPipelineTask = { description: 'Build ETL pipeline for merchant data ingestion' };
const contentTask = { description: 'Write SEO-optimized blog post about laptops in Singapore', labels: ['content'] };
const designTask = { description: 'Design new landing page UI mockup', labels: ['design'] };
const researchTask = { description: 'Market research on competitor pricing strategies', labels: ['research'] };
const unknownTask = { description: 'General administrative task' };
(0, node_test_1.describe)('Engineering task guard', () => {
    (0, node_test_1.it)('allows engineer agents for engineering tasks', () => {
        strict_1.default.equal((0, roleGuard_1.checkAgentTaskCompatibility)(engineer, scrapingTask).allowed, true);
        strict_1.default.equal((0, roleGuard_1.checkAgentTaskCompatibility)(engineer, apiTask).allowed, true);
        strict_1.default.equal((0, roleGuard_1.checkAgentTaskCompatibility)(engineer, deploymentTask).allowed, true);
        strict_1.default.equal((0, roleGuard_1.checkAgentTaskCompatibility)(engineer, dataPipelineTask).allowed, true);
    });
    (0, node_test_1.it)('allows qa agents for engineering tasks', () => {
        strict_1.default.equal((0, roleGuard_1.checkAgentTaskCompatibility)(qa, scrapingTask).allowed, true);
    });
    (0, node_test_1.it)('allows cto for engineering tasks', () => {
        strict_1.default.equal((0, roleGuard_1.checkAgentTaskCompatibility)(cto, apiTask).allowed, true);
    });
    (0, node_test_1.it)('blocks designer agents for engineering tasks', () => {
        const result = (0, roleGuard_1.checkAgentTaskCompatibility)(designer, apiTask);
        strict_1.default.equal(result.allowed, false);
        strict_1.default.match(result.reason, /blocklist/);
    });
    (0, node_test_1.it)('blocks researcher agents for engineering tasks', () => {
        const result = (0, roleGuard_1.checkAgentTaskCompatibility)(researcher, scrapingTask);
        strict_1.default.equal(result.allowed, false);
        strict_1.default.match(result.reason, /blocklist/);
    });
    (0, node_test_1.it)('blocks content role agents for engineering tasks', () => {
        const result = (0, roleGuard_1.checkAgentTaskCompatibility)(content, apiTask);
        strict_1.default.equal(result.allowed, false);
    });
    (0, node_test_1.it)('blocks cmo for engineering tasks', () => {
        strict_1.default.equal((0, roleGuard_1.checkAgentTaskCompatibility)(cmo, apiTask).allowed, false);
    });
    (0, node_test_1.it)('blocks pm for engineering tasks', () => {
        strict_1.default.equal((0, roleGuard_1.checkAgentTaskCompatibility)(pm, apiTask).allowed, false);
    });
    (0, node_test_1.it)('blocks general role for engineering tasks', () => {
        strict_1.default.equal((0, roleGuard_1.checkAgentTaskCompatibility)(general, dataPipelineTask).allowed, false);
    });
    (0, node_test_1.it)('blocks ceo for engineering tasks', () => {
        strict_1.default.equal((0, roleGuard_1.checkAgentTaskCompatibility)(ceo, apiTask).allowed, false);
    });
    (0, node_test_1.it)('rejects agents with unknown role for engineering tasks', () => {
        const unknown = { id: '99', name: 'Unknown', role: 'unknown' };
        const result = (0, roleGuard_1.checkAgentTaskCompatibility)(unknown, scrapingTask);
        strict_1.default.equal(result.allowed, false);
    });
});
(0, node_test_1.describe)('Non-engineering task guards', () => {
    (0, node_test_1.it)('allows designer for design tasks', () => {
        strict_1.default.equal((0, roleGuard_1.checkAgentTaskCompatibility)(designer, designTask).allowed, true);
    });
    (0, node_test_1.it)('blocks engineer for design tasks', () => {
        const result = (0, roleGuard_1.checkAgentTaskCompatibility)(engineer, designTask);
        strict_1.default.equal(result.allowed, false);
    });
    (0, node_test_1.it)('allows researcher for research tasks', () => {
        strict_1.default.equal((0, roleGuard_1.checkAgentTaskCompatibility)(researcher, researchTask).allowed, true);
    });
    (0, node_test_1.it)('allows content role for content tasks', () => {
        strict_1.default.equal((0, roleGuard_1.checkAgentTaskCompatibility)(content, contentTask).allowed, true);
    });
    (0, node_test_1.it)('allows general role for content tasks', () => {
        strict_1.default.equal((0, roleGuard_1.checkAgentTaskCompatibility)(general, contentTask).allowed, true);
    });
    (0, node_test_1.it)('allows cmo for content tasks', () => {
        strict_1.default.equal((0, roleGuard_1.checkAgentTaskCompatibility)(cmo, contentTask).allowed, true);
    });
    (0, node_test_1.it)('allows designer for content tasks', () => {
        strict_1.default.equal((0, roleGuard_1.checkAgentTaskCompatibility)(designer, contentTask).allowed, true);
    });
});
(0, node_test_1.describe)('Unknown task category', () => {
    (0, node_test_1.it)('defaults to engineering guard (blocks non-engineering roles)', () => {
        const result = (0, roleGuard_1.checkAgentTaskCompatibility)(designer, unknownTask);
        strict_1.default.equal(result.allowed, false);
    });
    (0, node_test_1.it)('allows engineer for unknown category tasks', () => {
        strict_1.default.equal((0, roleGuard_1.checkAgentTaskCompatibility)(engineer, unknownTask).allowed, true);
    });
    (0, node_test_1.it)('allows qa for unknown category tasks', () => {
        strict_1.default.equal((0, roleGuard_1.checkAgentTaskCompatibility)(qa, unknownTask).allowed, true);
    });
});
(0, node_test_1.describe)('Capability bonus in reason', () => {
    (0, node_test_1.it)('includes capability match in reason when agent capabilities match task sub-type', () => {
        const result = (0, roleGuard_1.checkAgentTaskCompatibility)(engineer, scrapingTask);
        strict_1.default.ok(result.reason.includes('scraper') || result.reason.includes('scraping'));
    });
    (0, node_test_1.it)('works for agents without capabilities', () => {
        const basicEngineer = { id: '99', name: 'Basic', role: 'engineer' };
        const result = (0, roleGuard_1.checkAgentTaskCompatibility)(basicEngineer, apiTask);
        strict_1.default.equal(result.allowed, true);
    });
});
(0, node_test_1.describe)('Category inference from labels', () => {
    (0, node_test_1.it)('infers engineering from scraping label', () => {
        const result = (0, roleGuard_1.checkAgentTaskCompatibility)(engineer, { description: 'task', labels: ['scraping'] });
        strict_1.default.equal(result.category, 'engineering');
    });
    (0, node_test_1.it)('infers design from design label', () => {
        const result = (0, roleGuard_1.checkAgentTaskCompatibility)(designer, { description: 'task', labels: ['design'] });
        strict_1.default.equal(result.category, 'design');
    });
    (0, node_test_1.it)('infers content from content label', () => {
        const result = (0, roleGuard_1.checkAgentTaskCompatibility)(content, { description: 'task', labels: ['content'] });
        strict_1.default.equal(result.category, 'content');
    });
});
