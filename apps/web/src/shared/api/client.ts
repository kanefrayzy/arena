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

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
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
};
