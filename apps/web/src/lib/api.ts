export const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3001';

export type ApiUser = {
  id: string;
  name: string;
  account: string;
  role: string;
  managerId?: string | null;
};

export function getToken() {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem('accessToken');
}

export function setToken(token: string) {
  window.localStorage.setItem('accessToken', token);
}

export function clearToken() {
  window.localStorage.removeItem('accessToken');
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers = new Headers(init.headers);

  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  if (!(init.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    headers,
  });

  if (response.status === 401) {
    clearToken();
    window.location.href = '/login';
  }

  if (!response.ok) {
    const text = await response.text();
    let message: string | undefined;
    try {
      const payload = JSON.parse(text) as { message?: string | string[] };
      message = Array.isArray(payload.message) ? payload.message.join('；') : payload.message;
    } catch {}
    throw new Error(message || text || `请求失败（${response.status}）`);
  }

  return response.json() as Promise<T>;
}
