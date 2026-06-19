"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkAgentTaskCompatibility = checkAgentTaskCompatibility;
const roleMap_1 = require("./roleMap");
function checkAgentTaskCompatibility(agent, task) {
    const category = resolveTaskCategory(task);
    const agentRole = agent.role;
    if (category === 'engineering' || category === null) {
        if (roleMap_1.NON_ENGINEERING_ROLES.has(agentRole)) {
            return {
                allowed: false,
                reason: `Agent role "${agent.role}" is not allowed for engineering tasks. Role is in the non-engineering blocklist. Select an agent with role: engineer, qa, or cto.`,
                category,
                matchedRole: agent.role,
            };
        }
    }
    if (category && roleMap_1.ROLE_ALLOWLIST[category]) {
        const allowedRoles = roleMap_1.ROLE_ALLOWLIST[category];
        if (!allowedRoles.has(agentRole)) {
            return {
                allowed: false,
                reason: `Agent role "${agent.role}" is not in the allowlist for category "${category}". Allowed roles: ${[...allowedRoles].join(', ')}.`,
                category,
                matchedRole: agent.role,
            };
        }
    }
    const subType = category === 'engineering' && task.description
        ? (0, roleMap_1.inferEngineeringSubType)(task.description)
        : null;
    let capabilityBonus = '';
    if (subType && agent.capabilities) {
        const capLower = agent.capabilities.toLowerCase();
        const subTypeTerms = {
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
function resolveTaskCategory(task) {
    if (task.category && task.category !== 'unknown') {
        return task.category;
    }
    if (task.labels && task.labels.length > 0) {
        const fromLabels = (0, roleMap_1.getTaskCategoryFromLabels)(task.labels);
        if (fromLabels)
            return fromLabels;
    }
    if (task.description) {
        const fromDesc = (0, roleMap_1.inferTaskCategoryFromDescription)(task.description);
        if (fromDesc)
            return fromDesc;
    }
    if (task.title) {
        const fromTitle = (0, roleMap_1.inferTaskCategoryFromDescription)(task.title);
        if (fromTitle)
            return fromTitle;
    }
    return null;
}
