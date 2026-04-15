import { Request, Response, NextFunction } from 'express';

export interface AgentInfo {
  framework: string;
  version: string;
  sdkLanguage: string;
}

// Detect agent framework from User-Agent header
// Priority: X-Agent-Framework header > User-Agent heuristics > unknown
export function detectAgentFramework(userAgent: string, xAgentFramework?: string): AgentInfo {
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

declare global {
  namespace Express {
    interface Request {
      agentInfo?: AgentInfo;
      apiKeyRecord?: {
        id: string;
        key: string;
        agentName: string;
        tier: string;
        rpmLimit: number;
        dailyLimit: number;
        signupChannel: string | null;
        attributionSource: string | null;
      };
    }
  }
}

export function agentDetectMiddleware(req: Request, _res: Response, next: NextFunction): void {
  const ua = req.headers['user-agent'] || '';
  const xFramework = req.headers['x-agent-framework'] as string | undefined;
  req.agentInfo = detectAgentFramework(ua, xFramework);
  next();
}
