const API_BASE = '/api';

async function fetchJSON<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });
  return response.json() as Promise<T>;
}

export const apiClient = {
  async getAiConfig(): Promise<{ success: boolean }> {
    return fetchJSON<{ success: boolean }>('/ai/config', { method: 'GET' });
  },

  async saveAiConfig(data: { model: string }): Promise<{ success: boolean }> {
    return fetchJSON<{ success: boolean }>('/ai/config', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async getFacebookStatus(): Promise<{ connected: boolean }> {
    return fetchJSON<{ connected: boolean }>('/facebook/oauth/status', { method: 'GET' });
  },

  createChatStream(message: string): EventSource {
    const params = new URLSearchParams({ message });
    return new EventSource(`${API_BASE}/chat?${params.toString()}`, { withCredentials: true });
  },
};
