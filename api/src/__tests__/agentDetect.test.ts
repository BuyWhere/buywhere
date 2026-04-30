import { detectAgentFramework } from '../middleware/agentDetect';

describe('detectAgentFramework', () => {
  describe('X-Agent-Framework header override', () => {
    it('returns langchain for x-agent-framework=langchain', () => {
      const result = detectAgentFramework('', 'langchain');
      expect(result.framework).toBe('langchain');
    });

    it('normalises unknown x-agent-framework values to custom', () => {
      const result = detectAgentFramework('', 'my-special-bot');
      expect(result.framework).toBe('custom');
    });

    it('supports crewai via header', () => {
      const result = detectAgentFramework('', 'crewai');
      expect(result.framework).toBe('crewai');
    });
  });

  describe('User-Agent heuristics', () => {
    it('detects langchain from UA with Python', () => {
      const ua = 'python-httpx/0.24 langchain/0.1.0 python/3.11';
      const result = detectAgentFramework(ua);
      expect(result.framework).toBe('langchain');
      expect(result.sdkLanguage).toBe('python');
    });

    it('detects langchain with js SDK', () => {
      const ua = 'langchain/0.2.1 node/20.0.0';
      const result = detectAgentFramework(ua);
      expect(result.framework).toBe('langchain');
      expect(result.sdkLanguage).toBe('javascript');
    });

    it('detects langchain with unknown SDK', () => {
      const ua = 'langchain/0.1.5';
      const result = detectAgentFramework(ua);
      expect(result.framework).toBe('langchain');
      expect(result.sdkLanguage).toBe('unknown');
    });

    it('detects crewai from UA', () => {
      const ua = 'crewai/0.30.0 python/3.11';
      const result = detectAgentFramework(ua);
      expect(result.framework).toBe('crewai');
      expect(result.sdkLanguage).toBe('python');
    });

    it('detects autogen from UA', () => {
      const ua = 'autogen/0.2.0 python/3.10';
      const result = detectAgentFramework(ua);
      expect(result.framework).toBe('autogen');
    });

    it('detects python SDK', () => {
      const result = detectAgentFramework('python-requests/2.28');
      expect(result.framework).toBe('custom');
      expect(result.sdkLanguage).toBe('python');
    });

    it('detects Node.js / axios', () => {
      const result = detectAgentFramework('axios/1.6.0 node.js/20.0');
      expect(result.framework).toBe('custom');
      expect(result.sdkLanguage).toBe('javascript');
    });

    it('detects curl', () => {
      const result = detectAgentFramework('curl/7.88.0');
      expect(result.framework).toBe('custom');
      expect(result.sdkLanguage).toBe('shell');
    });

    it('returns unknown for empty UA', () => {
      const result = detectAgentFramework('');
      expect(result.framework).toBe('unknown');
      expect(result.version).toBe('');
      expect(result.sdkLanguage).toBe('unknown');
    });

    it('returns unknown for browser UA', () => {
      const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36';
      const result = detectAgentFramework(ua);
      expect(result.framework).toBe('unknown');
    });
  });
});
