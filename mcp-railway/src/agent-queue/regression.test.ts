import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { checkAgentTaskCompatibility } from './roleGuard';

const copyAgent = { id: 'copy-1', name: 'Copy', role: 'content', capabilities: 'Content writing, copywriting, SEO content', title: 'Content Specialist' };
const blogAgent = { id: 'blog-1', name: 'Blog', role: 'content', capabilities: 'Content writing', title: 'Content Specialist' };
const draftAgent = { id: 'draft-1', name: 'Draft', role: 'content', capabilities: 'Content writing', title: 'Content Specialist' };

describe('BUY-3265 regression — content specialists must not receive engineering tasks', () => {
  it('blocks Copy from API engineering tasks (was BUY-3253/BUY-3254)', () => {
    const result = checkAgentTaskCompatibility(copyAgent, {
      description: 'Implement paginated product listing endpoint',
      labels: ['api'],
    });
    assert.equal(result.allowed, false);
  });

  it('blocks Blog from scraping tasks (was BUY-3120)', () => {
    const result = checkAgentTaskCompatibility(blogAgent, {
      description: 'Build Nike US scraper',
    });
    assert.equal(result.allowed, false);
  });

  it('blocks Draft from CI/CD pipeline tasks (was BUY-2169)', () => {
    const result = checkAgentTaskCompatibility(draftAgent, {
      description: 'Set up CI/CD pipeline and staging deployment automation for BuyWhere API',
    });
    assert.equal(result.allowed, false);
  });

  it('blocks Copy from data pipeline tasks (was BUY-2125)', () => {
    const result = checkAgentTaskCompatibility(copyAgent, {
      description: 'Backfill existing SG products with region/country_code tags',
      labels: ['data pipeline'],
    });
    assert.equal(result.allowed, false);
  });

  it('allows Copy for content tasks (no regression on legitimate assignments)', () => {
    const result = checkAgentTaskCompatibility(copyAgent, {
      description: 'Write API documentation for MCP server',
      labels: ['content'],
    });
    assert.equal(result.allowed, true);
  });
});
