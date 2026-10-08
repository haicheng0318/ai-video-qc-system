// Keep production browser requests on the same origin by default. Using a
// localhost fallback here is unsafe for a client bundle: Next.js can fold the
// server-side branch at build time and make every user's browser call its own
// port 3001 instead of the deployed API reverse proxy.
const configuredApiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL?.trim();

export const apiBaseUrl = configuredApiBaseUrl
  ? configuredApiBaseUrl.replace(/\/$/, '')
  : '';

export type ApiUser = {
  id: string;
  name: string;
  account: string;
  role: string;
  managerId?: string | null;
  department?: string | null;
  expiresAt?: string | null;
  mustChangePassword?: boolean;
};

export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const method = (init.method || 'GET').toUpperCase();

  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    headers.set('X-QC-CSRF', '1');
  }

  if (init.body != null && !(init.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    headers,
    credentials: 'include',
  });

  if (response.status === 401 && path.split('?')[0] !== '/api/auth/login') {
    if (typeof window !== 'undefined') window.location.href = '/login';
  }

  if (!response.ok) {
    const text = await response.text();
    let message: string | undefined;
    try {
      const payload = JSON.parse(text) as { message?: string | string[] };
      message = Array.isArray(payload.message) ? payload.message.join('；') : payload.message;
    } catch {}
    throw new ApiRequestError(
      message || text || `请求失败（${response.status}）`,
      response.status,
    );
  }

  return response.json() as Promise<T>;
}
