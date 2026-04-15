"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.queryLogMiddleware = queryLogMiddleware;
const config_1 = require("../config");
// Known human User-Agent patterns — browsers, Googlebot, etc.
const HUMAN_UA_PATTERNS = [
    /mozilla/i,
    /chrome/i,
    /safari/i,
    /firefox/i,
    /edge/i,
    /opera/i,
    /googlebot/i,
    /bingbot/i,
];
/**
 * Classify whether a request is from an AI agent or a human browser.
 * Heuristic: if the agent detection middleware identified a known framework,
 * or the User-Agent doesn't match any browser pattern, treat it as an agent.
 */
function classifyIsAgent(req) {
    const framework = req.agentInfo?.framework;
    // Known agent frameworks are always agents
    if (framework && framework !== 'unknown')
        return true;
    const ua = req.headers['user-agent'] || '';
    // No User-Agent at all → likely a programmatic client
    if (!ua)
        return true;
    // X-Agent-Framework header present → agent
    if (req.headers['x-agent-framework'])
        return true;
    // If UA matches a browser pattern, it's likely human
    if (HUMAN_UA_PATTERNS.some((p) => p.test(ua)))
        return false;
    // Default: treat as agent (this is an agent-first API)
    return true;
}
/**
 * Express middleware that logs authenticated API requests to the query_log table.
 * Fire-and-forget — never blocks the response.
 *
 * Attach AFTER agentDetectMiddleware and requireApiKey so req.agentInfo and
 * req.apiKeyRecord are populated.
 */
function queryLogMiddleware(endpoint) {
    return (req, res, next) => {
        const start = Date.now();
        // Hook into response finish to capture status code and timing
        res.on('finish', () => {
            const apiKeyRecord = req.apiKeyRecord;
            if (!apiKeyRecord)
                return; // No auth = no log
            const responseTimeMs = Date.now() - start;
            const isAgent = classifyIsAgent(req);
            // Extract query text from common params
            const queryText = req.query.q || req.query.ids || null;
            config_1.db.query(`INSERT INTO query_log
          (api_key_id, agent_name, agent_framework, sdk_language, is_agent,
           endpoint, query_text, result_count, response_time_ms,
           status_code, ip_address, user_agent)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`, [
                apiKeyRecord.id,
                apiKeyRecord.agentName,
                req.agentInfo?.framework || 'unknown',
                req.agentInfo?.sdkLanguage || 'unknown',
                isAgent,
                endpoint,
                queryText,
                null, // result_count filled by specific endpoints if needed
                responseTimeMs,
                res.statusCode,
                req.ip || null,
                (req.headers['user-agent'] || '').slice(0, 500),
            ]).catch(() => {
                // Fire-and-forget — don't crash on log failure
            });
        });
        next();
    };
}
