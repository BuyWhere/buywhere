import { checkAgentTaskCompatibility, AgentInfo } from './roleGuard';
import { inferEngineeringSubType } from './roleMap';

const PAPERCLIP_API_URL = process.env.PAPERCLIP_API_URL || 'https://api.paperclip.ai';

interface PaperclipAgent {
  id: string;
  name: string;
  role?: string;
  title?: string;
  capabilities?: string;
}

interface PaperclipIssue {
  id: string;
  identifier: string;
  title: string;
  description: string;
  labels?: { name: string }[];
  status?: string;
  priority?: string;
}

interface CliTaskInfo {
  id?: string;
  title?: string;
  description: string;
  labels?: string[];
}

function usage(): void {
  console.log(`
Usage:
  # Check agent-task compatibility by Agent ID and Issue ID
  PAPERCLIP_API_KEY=<key> npx ts-node src/agent-queue/cli.ts agent-issue <agent-id> <issue-id>

  # Check agent-task compatibility by Agent ID and task description
  PAPERCLIP_API_KEY=<key> npx ts-node src/agent-queue/cli.ts agent-task <agent-id> "<task-description>"

  # Validate that no non-engineering agents appear in the engineering pool
  PAPERCLIP_API_KEY=<key> npx ts-node src/agent-queue/cli.ts validate-pool

  # List all agents by role
  PAPERCLIP_API_KEY=<key> npx ts-node src/agent-queue/cli.ts list-roles
`);
}

async function fetchFromPaperclip<T>(path: string): Promise<T> {
  const apiKey = process.env.PAPERCLIP_API_KEY;
  if (!apiKey) {
    throw new Error('PAPERCLIP_API_KEY environment variable is required');
  }
  const resp = await fetch(`${PAPERCLIP_API_URL}${path}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!resp.ok) {
    throw new Error(`Paperclip API returned ${resp.status} for ${path}: ${await resp.text()}`);
  }
  return resp.json() as Promise<T>;
}

function getCompanyId(): string {
  return process.env.PAPERCLIP_COMPANY_ID || '';
}

function resolveTaskDescription(task: PaperclipIssue): CliTaskInfo {
  return {
    id: task.identifier,
    title: task.title,
    description: task.description || task.title || '',
    labels: task.labels?.map(l => l.name) || [],
  };
}

async function fetchAgent(companyId: string, agentIdOrName: string): Promise<PaperclipAgent> {
  const agents = await fetchFromPaperclip<PaperclipAgent[]>(`/api/companies/${companyId}/agents`);
  const agent = agents.find(
    (a: PaperclipAgent) => a.id === agentIdOrName || a.name === agentIdOrName
  );
  if (!agent) throw new Error(`Agent not found: ${agentIdOrName}`);
  return agent;
}

async function cmdAgentIssue(agentIdOrName: string, issueId: string): Promise<void> {
  const companyId = getCompanyId();
  if (!companyId) {
    console.error('PAPERCLIP_COMPANY_ID environment variable is required');
    process.exit(1);
  }

  const [agent, issue] = await Promise.all([
    fetchAgent(companyId, agentIdOrName),
    fetchFromPaperclip<PaperclipIssue>(`/api/issues/${issueId}`),
  ]);

  const agentInfo: AgentInfo = {
    id: agent.id,
    name: agent.name,
    role: agent.role || 'unknown',
    capabilities: agent.capabilities,
    title: agent.title,
  };

  const taskInfo = resolveTaskDescription(issue);
  const result = checkAgentTaskCompatibility(agentInfo, taskInfo);

  const subType = inferEngineeringSubType(taskInfo.description);

  console.log(`
Agent:      ${agentInfo.name} (${agentInfo.id.slice(0, 8)}...)
Role:       ${agentInfo.role}
Capability: ${agentInfo.capabilities || '(none)'}
Title:      ${agentInfo.title || '(none)'}
---
Task:       ${taskInfo.id || '(inline)'}
Title:      ${taskInfo.title || '(none)'}
Labels:     ${taskInfo.labels?.join(', ') || '(none)'}
Sub-type:   ${subType || '(none)'}
---
Result:     ${result.allowed ? 'ALLOWED' : 'BLOCKED'}
Reason:     ${result.reason}
`);
}

async function cmdAgentTask(agentIdOrName: string, taskDescription: string): Promise<void> {
  const companyId = getCompanyId();
  if (!companyId) {
    console.error('PAPERCLIP_COMPANY_ID environment variable is required');
    process.exit(1);
  }

  const agent = await fetchAgent(companyId, agentIdOrName);

  const agentInfo: AgentInfo = {
    id: agent.id,
    name: agent.name,
    role: agent.role || 'unknown',
    capabilities: agent.capabilities,
    title: agent.title,
  };

  const taskInfo: CliTaskInfo = {
    description: taskDescription,
  };

  const result = checkAgentTaskCompatibility(agentInfo, taskInfo);
  const subType = inferEngineeringSubType(taskInfo.description);

  console.log(`
Agent:      ${agentInfo.name} (${agentInfo.id.slice(0, 8)}...)
Role:       ${agentInfo.role}
Capability: ${agentInfo.capabilities || '(none)'}
---
Task:       "${taskDescription.slice(0, 80)}${taskDescription.length > 80 ? '...' : ''}"
Sub-type:   ${subType || '(none)'}
---
Result:     ${result.allowed ? 'ALLOWED' : 'BLOCKED'}
Reason:     ${result.reason}
`);
}

async function cmdValidatePool(): Promise<void> {
  const companyId = getCompanyId();
  if (!companyId) {
    console.error('PAPERCLIP_COMPANY_ID environment variable is required');
    process.exit(1);
  }

  const agents = await fetchFromPaperclip<PaperclipAgent[]>(`/api/companies/${companyId}/agents`);

  const engineeringSample = `Scraping product data from merchant websites and normalizing into the catalog.`;
  const engineeringResult = { description: engineeringSample, labels: ['scraping'] };

  let issuesFound = 0;
  for (const agent of agents) {
    const agentInfo: AgentInfo = {
      id: agent.id,
      name: agent.name,
      role: agent.role || 'unknown',
      capabilities: agent.capabilities,
      title: agent.title,
    };
    const result = checkAgentTaskCompatibility(agentInfo, engineeringResult);
    if (!result.allowed) {
      issuesFound++;
      console.log(`[BLOCKED] ${agent.name.padEnd(20)} role=${agent.role} — ${result.reason}`);
    }
  }

  if (issuesFound === 0) {
    console.log(`\n✓ All ${agents.length} agents validated. No non-engineering agents would receive engineering tasks.`);
  } else {
    console.log(`\n✓ ${issuesFound}/${agents.length} agents correctly blocked from engineering pool.`);
  }

  const allRoles = new Map<string, number>();
  for (const agent of agents) {
    const role = agent.role || 'unknown';
    allRoles.set(role, (allRoles.get(role) || 0) + 1);
  }

  console.log('\nRole distribution:');
  for (const [role, count] of [...allRoles.entries()].sort()) {
    console.log(`  ${role.padEnd(15)} ${count} agent(s)`);
  }
}

async function cmdListRoles(): Promise<void> {
  const companyId = getCompanyId();
  if (!companyId) {
    console.error('PAPERCLIP_COMPANY_ID environment variable is required');
    process.exit(1);
  }

  const agents = await fetchFromPaperclip<PaperclipAgent[]>(`/api/companies/${companyId}/agents`);

  const byRole = new Map<string, PaperclipAgent[]>();
  for (const agent of agents) {
    const role = agent.role || 'unknown';
    if (!byRole.has(role)) byRole.set(role, []);
    byRole.get(role)!.push(agent);
  }

  console.log('\nAgents by role:');
  for (const [role, agents] of [...byRole.entries()].sort()) {
    console.log(`\n  ${role}:`);
    for (const a of agents) {
      console.log(`    - ${a.name.padEnd(22)} ${a.title || '(no title)'}`);
    }
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const cmd = args[0];

  if (!cmd) {
    usage();
    process.exit(1);
  }

  try {
    switch (cmd) {
      case 'agent-issue':
        if (args.length < 3) { usage(); process.exit(1); }
        await cmdAgentIssue(args[1], args[2]);
        break;
      case 'agent-task':
        if (args.length < 3) { usage(); process.exit(1); }
        await cmdAgentTask(args[1], args[2]);
        break;
      case 'validate-pool':
        await cmdValidatePool();
        break;
      case 'list-roles':
        await cmdListRoles();
        break;
      default:
        usage();
        process.exit(1);
    }
  } catch (err) {
    console.error('Error:', err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

main();
