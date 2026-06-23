"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.queryLogMiddleware = queryLogMiddleware;
const config_1 = require("../config");
const posthog_1 = require("../analytics/posthog");
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
 * Extract result count from a response body.
 * Handles standard REST and JSON-RPC MCP envelopes.
 *
 * - Array data/results → length
 * - Single object data → 1 (product lookup, category detail)
 * - Error responses (4xx+) → null
 * - JSON-RPC → unwrap text content and recurse
 */
function extractResultCount(body, statusCode) {
    if (statusCode >= 400)
        return null;
    if (!body || typeof body !== 'object')
        return null;
    const b = body;
    // JSON-RPC MCP envelope — unwrap text content
    if (b.jsonrpc === '2.0') {
        const result = b.result;
        if (result && typeof result === 'object') {
            const r = result;
            if (Array.isArray(r.content) && r.content.length === 1) {
                const content = r.content[0];
                if (content.type === 'text' && typeof content.text === 'string') {
                    try {
                        const inner = JSON.parse(content.text);
                        return extractResultCount(inner, 200);
                    }
                    catch { /* not JSON — skip */ }
                }
            }
        }
        return null;
    }
    if (Array.isArray(b.data))
        return b.data.length;
    if (Array.isArray(b.results))
        return b.results.length;
    if (b.data && typeof b.data === 'object')
        return 1;
    return null;
}
/**
 * Extract query text from JSON-RPC MCP `tools/call` request body.
 *
 * The JSON-RPC envelope is `{ jsonrpc, id, method, params: { name, arguments: {...} } }`
 * and the user-supplied search/category/id lives in `arguments`. BUY-55788
 * documented that the BUY-31507 claim "set res.locals.queryText = toolArgs.q"
 * never landed, so 100% of MCP events had null query_text. This extractor
 * reads the same data at finish time without depending on route handlers.
 *
 * Returns the first useful string we find, in priority order:
 *   q → query → product_name → category → joined ids
 */
function extractJsonRpcQueryText(req) {
    if (!req.body || typeof req.body !== 'object')
        return null;
    const body = req.body;
    if (body.jsonrpc !== '2.0')
        return null;
    const params = body.params;
    if (!params || typeof params !== 'object' || Array.isArray(params))
        return null;
    const args = params.arguments;
    if (!args || typeof args !== 'object' || Array.isArray(args))
        return null;
    const a = args;
    for (const key of ['q', 'query', 'product_name', 'name', 'category']) {
        const v = a[key];
        if (typeof v === 'string' && v.length > 0 && v.length <= 500)
            return v;
    }
    const ids = a.ids;
    if (Array.isArray(ids) && ids.length > 0) {
        return ids.slice(0, 10).map(String).join(',');
    }
    return null;
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
        // Intercept res.json to capture result count from the response body
        // before it's sent to the client (the finish handler reads res.locals).
        const originalJson = res.json.bind(res);
        res.json = function (body) {
            res.locals.resultCount = extractResultCount(body, res.statusCode);
            return originalJson(body);
        };
        // Hook into response finish to capture status code, timing, and result count
        res.once('finish', () => {
            const apiKeyRecord = req.apiKeyRecord;
            // Log all requests — unauthenticated ones recorded with null api_key_id
            // so we capture total demand even before API key adoption ramps up.
            const responseTimeMs = Date.now() - start;
            const isAgent = classifyIsAgent(req);
            // Extract query text — URL params first, then JSON-RPC body for MCP.
            // BUY-55788: the MCP `tools/call` envelope carries the query in
            // params.arguments, not in req.query. Without this fallback, 100% of
            // MCP events were recorded with null query_text (verified 2026-06-22).
            const queryText = req.query.q ||
                req.query.ids ||
                extractJsonRpcQueryText(req) ||
                null;
            config_1.db.query(`INSERT INTO query_log
          (api_key_id, agent_name, agent_framework, sdk_language, is_agent,
           endpoint, query_text, result_count, response_time_ms,
           status_code, ip_address, user_agent)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`, [
                apiKeyRecord?.id ?? null,
                apiKeyRecord?.agentName ?? null,
                req.agentInfo?.framework || 'unknown',
                req.agentInfo?.sdkLanguage || 'unknown',
                isAgent,
                endpoint,
                queryText,
                res.locals.resultCount ?? null,
                responseTimeMs,
                res.statusCode,
                req.ip || null,
                (req.headers['user-agent'] || '').slice(0, 500),
            ]).catch(() => {
                // Fire-and-forget — don't crash on log failure
            });
            // BUY-22733: source-of-truth usage telemetry to PostHog.
            // Skip unauthenticated requests — no api_key_id to attribute.
            // BUY-31298: route handlers set res.locals.queryIntent / productCategories /
            // signupChannel / sourcePage so this single event carries all analytics context.
            if (apiKeyRecord?.id) {
                try {
                    (0, posthog_1.trackApiUsage)({
                        apiKeyId: apiKeyRecord.id,
                        endpoint,
                        method: req.method,
                        tier: apiKeyRecord.tier,
                        resultStatus: res.statusCode,
                        latencyMs: responseTimeMs,
                        toolName: res.locals.mcpToolName || null,
                        queryIntent: res.locals.queryIntent || null,
                        productCategories: res.locals.productCategories || null,
                        signupChannel: res.locals.signupChannel || null,
                        sourcePage: res.locals.sourcePage || null,
                    });
                }
                catch {
                    // PostHog client errors must never affect the response.
                }
            }
        });
        next();
    };
}
