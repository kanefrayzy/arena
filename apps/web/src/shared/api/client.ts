/**
 * Thin REST client. Cookies (auth) handled by browser.
 * For mutations: server expects X-CSRF-Token header (added in M2).
 */

const BASE = '/api';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

// Prevent concurrent refresh attempts
let refreshPromise: Promise<boolean> | null = null;

async function tryRefresh(): Promise<boolean> {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    try {
      const res = await fetch(`${BASE}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
      });
      return res.ok;
    } catch {
      return false;
    } finally {
      refreshPromise = null;
    }
  })();
  return refreshPromise;
}

async function request<T>(method: string, path: string, body?: unknown, isRetry = false): Promise<T> {
  const init: RequestInit = {
    method,
    credentials: 'include',
  };
  if (body !== undefined) {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(body);
  }
  const res = await fetch(`${BASE}${path}`, init);

  if (res.status === 204) return undefined as T;

  const json = (await res.json().catch(() => null)) as
    | { error?: { code: string; message: string; details?: unknown } }
    | T
    | null;

  if (!res.ok) {
    if (res.status === 401 && !isRetry && path !== '/auth/refresh') {
      // Try to silently refresh the access token, then retry once
      const refreshed = await tryRefresh();
      if (refreshed) {
        return request<T>(method, path, body, true);
      }
      // Refresh also failed — redirect to login
      const p = window.location.pathname;
      if (p !== '/' && p !== '/login' && p !== '/register') {
        window.location.replace('/');
      }
    }
    const err = (json as { error?: { code: string; message: string } })?.error;
    throw new ApiError(
      res.status,
      err?.code ?? 'ERROR',
      err?.message ?? `HTTP ${res.status}`,
      (json as { error?: { details?: unknown } })?.error?.details,
    );
  }
  return json as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  delete: <T>(path: string) => request<T>('DELETE', path),
  postForm: async <T>(path: string, form: FormData, isRetry = false): Promise<T> => {
    const res = await fetch(`${BASE}${path}`, {
      method: 'POST',
      credentials: 'include',
      body: form,
    });
    if (res.status === 204) return undefined as T;
    const json = (await res.json().catch(() => null)) as
      | { error?: { code: string; message: string; details?: unknown } }
      | T
      | null;
    if (!res.ok) {
      if (res.status === 401 && !isRetry) {
        const refreshed = await tryRefresh();
        if (refreshed) return api.postForm<T>(path, form, true);
        const p = window.location.pathname;
        if (p !== '/' && p !== '/login' && p !== '/register') {
          window.location.replace('/');
        }
      }
      const err = (json as { error?: { code: string; message: string } })?.error;
      throw new ApiError(
        res.status,
        err?.code ?? 'ERROR',
        err?.message ?? `HTTP ${res.status}`,
        (json as { error?: { details?: unknown } })?.error?.details,
      );
    }
    return json as T;
  },
};
