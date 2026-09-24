"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const roleGuard_1 = require("./roleGuard");
const copyAgent = { id: 'copy-1', name: 'Copy', role: 'content', capabilities: 'Content writing, copywriting, SEO content', title: 'Content Specialist' };
const blogAgent = { id: 'blog-1', name: 'Blog', role: 'content', capabilities: 'Content writing', title: 'Content Specialist' };
const draftAgent = { id: 'draft-1', name: 'Draft', role: 'content', capabilities: 'Content writing', title: 'Content Specialist' };
(0, node_test_1.describe)('BUY-3265 regression — content specialists must not receive engineering tasks', () => {
    (0, node_test_1.it)('blocks Copy from API engineering tasks (was BUY-3253/BUY-3254)', () => {
        const result = (0, roleGuard_1.checkAgentTaskCompatibility)(copyAgent, {
            description: 'Implement paginated product listing endpoint',
            labels: ['api'],
        });
        strict_1.default.equal(result.allowed, false);
    });
    (0, node_test_1.it)('blocks Blog from scraping tasks (was BUY-3120)', () => {
        const result = (0, roleGuard_1.checkAgentTaskCompatibility)(blogAgent, {
            description: 'Build Nike US scraper',
        });
        strict_1.default.equal(result.allowed, false);
    });
    (0, node_test_1.it)('blocks Draft from CI/CD pipeline tasks (was BUY-2169)', () => {
        const result = (0, roleGuard_1.checkAgentTaskCompatibility)(draftAgent, {
            description: 'Set up CI/CD pipeline and staging deployment automation for BuyWhere API',
        });
        strict_1.default.equal(result.allowed, false);
    });
    (0, node_test_1.it)('blocks Copy from data pipeline tasks (was BUY-2125)', () => {
        const result = (0, roleGuard_1.checkAgentTaskCompatibility)(copyAgent, {
            description: 'Backfill existing SG products with region/country_code tags',
            labels: ['data pipeline'],
        });
        strict_1.default.equal(result.allowed, false);
    });
    (0, node_test_1.it)('allows Copy for content tasks (no regression on legitimate assignments)', () => {
        const result = (0, roleGuard_1.checkAgentTaskCompatibility)(copyAgent, {
            description: 'Write API documentation for MCP server',
            labels: ['content'],
        });
        strict_1.default.equal(result.allowed, true);
    });
});
