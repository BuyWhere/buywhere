import {
  AgentRole,
  NON_ENGINEERING_ROLES,
  ROLE_ALLOWLIST,
  getTaskCategoryFromLabels,
  inferTaskCategoryFromDescription,
  inferEngineeringSubType,
  TaskCategory,
} from './roleMap';

export interface AgentInfo {
  id: string;
  name: string;
  role: AgentRole | string;
  capabilities?: string;
  title?: string;
}

export interface TaskInfo {
  id?: string;
  title?: string;
  description: string;
  labels?: string[];
  category?: TaskCategory | string;
}

export interface GuardResult {
  allowed: boolean;
  reason: string;
  category: TaskCategory | string | null;
  matchedRole: string | null;
}

export function checkAgentTaskCompatibility(
  agent: AgentInfo,
  task: TaskInfo
): GuardResult {
  const category = resolveTaskCategory(task);
  const agentRole = agent.role as AgentRole;

  if (category === 'engineering' || category === null) {
    if (NON_ENGINEERING_ROLES.has(agentRole as AgentRole)) {
      return {
        allowed: false,
        reason: `Agent role "${agent.role}" is not allowed for engineering tasks. Role is in the non-engineering blocklist. Select an agent with role: engineer, qa, or cto.`,
        category,
        matchedRole: agent.role,
      };
    }
  }

  if (category && ROLE_ALLOWLIST[category as TaskCategory]) {
    const allowedRoles = ROLE_ALLOWLIST[category as TaskCategory];
    if (!allowedRoles.has(agentRole as AgentRole)) {
      return {
        allowed: false,
        reason: `Agent role "${agent.role}" is not in the allowlist for category "${category}". Allowed roles: ${[...allowedRoles].join(', ')}.`,
        category,
        matchedRole: agent.role,
      };
    }
  }

  const subType = category === 'engineering' && task.description
    ? inferEngineeringSubType(task.description)
    : null;

  let capabilityBonus = '';
  if (subType && agent.capabilities) {
    const capLower = agent.capabilities.toLowerCase();
    const subTypeTerms: Record<string, string[]> = {
      scraping: ['scraper', 'scraping', 'crawl', 'extract'],
      api_work: ['api', 'rest', 'endpoint', 'mcp'],
      ci_cd: ['ci/cd', 'ci', 'cd', 'deploy', 'pipeline'],
      data_pipeline: ['etl', 'data pipeline', 'migration', 'data'],
      backend: ['backend', 'server', 'api'],
      frontend: ['frontend', 'ui'],
      devops: ['devops', 'infrastructure', 'deploy', 'kubernetes', 'docker'],
      platform: ['platform', 'infrastructure', 'system'],
    };

    const terms = subTypeTerms[subType] || [];
    const matchedTerms = terms.filter(t => capLower.includes(t));
    if (matchedTerms.length > 0) {
      capabilityBonus = ` Agent capabilities mention ${matchedTerms.join(', ')} — strong fit for ${subType} work.`;
    }
  }

  return {
    allowed: true,
    reason: `Agent role "${agent.role}" is compatible with task category "${category || 'unknown'}".${capabilityBonus}`,
    category,
    matchedRole: agent.role,
  };
}

function resolveTaskCategory(task: TaskInfo): TaskCategory | null {
  if (task.category && task.category !== 'unknown') {
    return task.category as TaskCategory;
  }

  if (task.labels && task.labels.length > 0) {
    const fromLabels = getTaskCategoryFromLabels(task.labels);
    if (fromLabels) return fromLabels;
  }

  if (task.description) {
    const fromDesc = inferTaskCategoryFromDescription(task.description);
    if (fromDesc) return fromDesc;
  }

  if (task.title) {
    const fromTitle = inferTaskCategoryFromDescription(task.title);
    if (fromTitle) return fromTitle;
  }

  return null;
}
