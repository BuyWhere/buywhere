const API_BASE = 'https://api.buywhere.ai';

export interface RegisterData {
  agent_name: string;
  email: string;
  company?: string;
  use_case?: string;
}

export interface LoginData {
  email: string;
  password: string;
}

export interface AuthResponse {
  api_key: string;
  user_id?: string;
  email?: string;
  email_verified?: boolean;
}

class AuthError extends Error {
  constructor(message: string, public statusCode?: number) {
    super(message);
    this.name = 'AuthError';
  }
}

export const Auth = {
  async login(apiKey: string): Promise<void> {
    const { persistDeveloperSession } = await import('./developer-session');
    if (!apiKey.trim()) {
      throw new AuthError('API key is required');
    }
    await persistDeveloperSession(apiKey.trim());
  },

  async register(data: RegisterData): Promise<AuthResponse> {
    const res = await fetch(`${API_BASE}/v1/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agent_name: data.agent_name,
        email: data.email,
        company: data.company || 'BuyWhere developer',
        use_case: data.use_case || undefined,
      }),
    });

    const responseData = await res.json();

    if (!res.ok) {
      throw new AuthError(
        responseData.error || responseData.message || 'Registration failed',
        res.status
      );
    }

    const { persistDeveloperSession } = await import('./developer-session');
    await persistDeveloperSession(responseData.api_key);

    return responseData as AuthResponse;
  },

  async logout(): Promise<void> {
    const { clearDeveloperSession } = await import('./developer-session');
    await clearDeveloperSession();
  },
};

export { AuthError };
