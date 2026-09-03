import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { checkAgentTaskCompatibility, AgentInfo, TaskInfo } from './roleGuard';

const engineer: AgentInfo = { id: '1', name: 'TestEngineer', role: 'engineer', capabilities: 'Backend API, scraping infrastructure' };
const designer: AgentInfo = { id: '2', name: 'TestDesigner', role: 'designer', capabilities: 'Visual design, brand identity' };
const researcher: AgentInfo = { id: '3', name: 'TestResearcher', role: 'researcher', capabilities: 'Market research, analysis' };
const content: AgentInfo = { id: '4', name: 'TestContent', role: 'content', capabilities: 'Copywriting, blog posts' };
const general: AgentInfo = { id: '5', name: 'TestGeneral', role: 'general', capabilities: 'Business development' };
const cmo: AgentInfo = { id: '6', name: 'TestCmo', role: 'cmo', capabilities: 'Marketing strategy' };
const pm: AgentInfo = { id: '7', name: 'TestPm', role: 'pm', capabilities: 'Product management' };
const qa: AgentInfo = { id: '8', name: 'TestQa', role: 'qa', capabilities: 'Testing and QA' };
const cto: AgentInfo = { id: '9', name: 'TestCto', role: 'cto', capabilities: 'Technical leadership' };
const ceo: AgentInfo = { id: '10', name: 'TestCeo', role: 'ceo', capabilities: 'Executive leadership' };

const scrapingTask: TaskInfo = { description: 'Build product scraper for merchant X', labels: ['scraping'] };
const apiTask: TaskInfo = { description: 'Implement paginated product listing API endpoint' };
const deploymentTask: TaskInfo = { description: 'Set up CI/CD pipeline with GitHub Actions and staging deployment' };
const dataPipelineTask: TaskInfo = { description: 'Build ETL pipeline for merchant data ingestion' };
const contentTask: TaskInfo = { description: 'Write SEO-optimized blog post about laptops in Singapore', labels: ['content'] };
const designTask: TaskInfo = { description: 'Design new landing page UI mockup', labels: ['design'] };
const researchTask: TaskInfo = { description: 'Market research on competitor pricing strategies', labels: ['research'] };
const unknownTask: TaskInfo = { description: 'General administrative task' };

describe('Engineering task guard', () => {
  it('allows engineer agents for engineering tasks', () => {
    assert.equal(checkAgentTaskCompatibility(engineer, scrapingTask).allowed, true);
    assert.equal(checkAgentTaskCompatibility(engineer, apiTask).allowed, true);
    assert.equal(checkAgentTaskCompatibility(engineer, deploymentTask).allowed, true);
    assert.equal(checkAgentTaskCompatibility(engineer, dataPipelineTask).allowed, true);
  });

  it('allows qa agents for engineering tasks', () => {
    assert.equal(checkAgentTaskCompatibility(qa, scrapingTask).allowed, true);
  });

  it('allows cto for engineering tasks', () => {
    assert.equal(checkAgentTaskCompatibility(cto, apiTask).allowed, true);
  });

  it('blocks designer agents for engineering tasks', () => {
    const result = checkAgentTaskCompatibility(designer, apiTask);
    assert.equal(result.allowed, false);
    assert.match(result.reason, /blocklist/);
  });

  it('blocks researcher agents for engineering tasks', () => {
    const result = checkAgentTaskCompatibility(researcher, scrapingTask);
    assert.equal(result.allowed, false);
    assert.match(result.reason, /blocklist/);
  });

  it('blocks content role agents for engineering tasks', () => {
    const result = checkAgentTaskCompatibility(content, apiTask);
    assert.equal(result.allowed, false);
  });

  it('blocks cmo for engineering tasks', () => {
    assert.equal(checkAgentTaskCompatibility(cmo, apiTask).allowed, false);
  });

  it('blocks pm for engineering tasks', () => {
    assert.equal(checkAgentTaskCompatibility(pm, apiTask).allowed, false);
  });

  it('blocks general role for engineering tasks', () => {
    assert.equal(checkAgentTaskCompatibility(general, dataPipelineTask).allowed, false);
  });

  it('blocks ceo for engineering tasks', () => {
    assert.equal(checkAgentTaskCompatibility(ceo, apiTask).allowed, false);
  });

  it('rejects agents with unknown role for engineering tasks', () => {
    const unknown: AgentInfo = { id: '99', name: 'Unknown', role: 'unknown' };
    const result = checkAgentTaskCompatibility(unknown, scrapingTask);
    assert.equal(result.allowed, false);
  });
});

describe('Non-engineering task guards', () => {
  it('allows designer for design tasks', () => {
    assert.equal(checkAgentTaskCompatibility(designer, designTask).allowed, true);
  });

  it('blocks engineer for design tasks', () => {
    const result = checkAgentTaskCompatibility(engineer, designTask);
    assert.equal(result.allowed, false);
  });

  it('allows researcher for research tasks', () => {
    assert.equal(checkAgentTaskCompatibility(researcher, researchTask).allowed, true);
  });

  it('allows content role for content tasks', () => {
    assert.equal(checkAgentTaskCompatibility(content, contentTask).allowed, true);
  });

  it('allows general role for content tasks', () => {
    assert.equal(checkAgentTaskCompatibility(general, contentTask).allowed, true);
  });

  it('allows cmo for content tasks', () => {
    assert.equal(checkAgentTaskCompatibility(cmo, contentTask).allowed, true);
  });

  it('allows designer for content tasks', () => {
    assert.equal(checkAgentTaskCompatibility(designer, contentTask).allowed, true);
  });
});

describe('Unknown task category', () => {
  it('defaults to engineering guard (blocks non-engineering roles)', () => {
    const result = checkAgentTaskCompatibility(designer, unknownTask);
    assert.equal(result.allowed, false);
  });

  it('allows engineer for unknown category tasks', () => {
    assert.equal(checkAgentTaskCompatibility(engineer, unknownTask).allowed, true);
  });

  it('allows qa for unknown category tasks', () => {
    assert.equal(checkAgentTaskCompatibility(qa, unknownTask).allowed, true);
  });
});

describe('Capability bonus in reason', () => {
  it('includes capability match in reason when agent capabilities match task sub-type', () => {
    const result = checkAgentTaskCompatibility(engineer, scrapingTask);
    assert.ok(result.reason.includes('scraper') || result.reason.includes('scraping'));
  });

  it('works for agents without capabilities', () => {
    const basicEngineer: AgentInfo = { id: '99', name: 'Basic', role: 'engineer' };
    const result = checkAgentTaskCompatibility(basicEngineer, apiTask);
    assert.equal(result.allowed, true);
  });
});

describe('Category inference from labels', () => {
  it('infers engineering from scraping label', () => {
    const result = checkAgentTaskCompatibility(engineer, { description: 'task', labels: ['scraping'] });
    assert.equal(result.category, 'engineering');
  });

  it('infers design from design label', () => {
    const result = checkAgentTaskCompatibility(designer, { description: 'task', labels: ['design'] });
    assert.equal(result.category, 'design');
  });

  it('infers content from content label', () => {
    const result = checkAgentTaskCompatibility(content, { description: 'task', labels: ['content'] });
    assert.equal(result.category, 'content');
  });
});
