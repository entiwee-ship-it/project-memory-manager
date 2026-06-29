import axios from 'axios';

const FACEBOOK_GRAPH_API_BASE = 'https://graph.facebook.com/v18.0';

export async function makeApiCall<T>(endpoint: string, method: 'GET' | 'POST' = 'GET'): Promise<T> {
  const url = endpoint.startsWith('http') ? endpoint : `${FACEBOOK_GRAPH_API_BASE}${endpoint}`;
  const response = await axios({
    method,
    url,
  });
  return response.data as T;
}
