"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.detectAgentFramework = detectAgentFramework;
exports.agentDetectMiddleware = agentDetectMiddleware;
// Detect agent framework from User-Agent header
// Priority: X-Agent-Framework header > User-Agent heuristics > unknown
function detectAgentFramework(userAgent, xAgentFramework) {
    if (xAgentFramework) {
        const norm = xAgentFramework.toLowerCase();
        const framework = ['langchain', 'crewai', 'autogen', 'custom'].includes(norm) ? norm : 'custom';
        return { framework, version: '', sdkLanguage: 'unknown' };
    }
    const ua = userAgent || '';
    // LangChain
    const langchainMatch = ua.match(/langchain[/-]([^\s;)]+)/i);
    if (langchainMatch) {
        const pyMatch = ua.match(/python[/-]([^\s;)]+)/i);
        const jsMatch = ua.match(/node[/-]([^\s;)]+)/i);
        return {
            framework: 'langchain',
            version: langchainMatch[1] || '',
            sdkLanguage: pyMatch ? 'python' : (jsMatch ? 'javascript' : 'unknown'),
        };
    }
    // CrewAI
    const crewaiMatch = ua.match(/crewai[/-]([^\s;)]+)/i);
    if (crewaiMatch) {
        return { framework: 'crewai', version: crewaiMatch[1] || '', sdkLanguage: 'python' };
    }
    // AutoGen
    const autogenMatch = ua.match(/autogen[/-]([^\s;)]+)/i);
    if (autogenMatch) {
        return { framework: 'autogen', version: autogenMatch[1] || '', sdkLanguage: 'python' };
    }
    // Python SDK
    if (/python/i.test(ua)) {
        return { framework: 'custom', version: '', sdkLanguage: 'python' };
    }
    // Node.js / JS SDK
    if (/node\.js|axios|got|undici/i.test(ua)) {
        return { framework: 'custom', version: '', sdkLanguage: 'javascript' };
    }
    // curl / raw HTTP
    if (/curl/i.test(ua)) {
        return { framework: 'custom', version: '', sdkLanguage: 'shell' };
    }
    return { framework: 'unknown', version: '', sdkLanguage: 'unknown' };
}
function agentDetectMiddleware(req, _res, next) {
    const ua = req.headers['user-agent'] || '';
    const xFramework = req.headers['x-agent-framework'];
    req.agentInfo = detectAgentFramework(ua, xFramework);
    next();
}
