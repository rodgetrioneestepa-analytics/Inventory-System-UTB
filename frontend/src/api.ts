import type { User } from '../../shared/api';
let csrf = '';
export const setCSRF = (value: string) => {
  csrf = value;
};
export class APIError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function api<T = any>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const unavailable = 'The inventory server is unavailable. Please try again shortly.';
  let response: Response;
  try {
    response = await fetch('/api' + path, {
      method,
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', ...(csrf ? { 'X-CSRF-Token': csrf } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new APIError(
      'Unable to connect. Please check your internet connection and try again.',
      0,
    );
  }
  let result;
  try {
    if (!response.headers.get('content-type')?.includes('application/json')) throw new Error();
    result = await response.json();
    if (result === null || typeof result !== 'object') throw new Error();
  } catch {
    throw new APIError(unavailable, response.status);
  }
  if (!response.ok)
    throw new APIError(
      (typeof result.error === 'string' ? result.error : unavailable) +
        (result.details
          ? ' — ' +
            (Array.isArray(result.details)
              ? result.details.map((i: any) => `${i.field}: ${i.message}`).join('; ')
              : JSON.stringify(result.details))
          : ''),
      response.status,
    );
  return result as T;
}
export async function currentUser() {
  const data = await api<{ user: User; csrf: string }>('/auth/me');
  setCSRF(data.csrf);
  return data.user;
}
export const money = (n: number | null) =>
  n === null
    ? 'Not configured'
    : new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(n);
export const number = (n: number | null) =>
  n === null
    ? 'Not configured'
    : new Intl.NumberFormat('en-PH', { maximumFractionDigits: 6 }).format(n);
export const date = (s: string) =>
  new Intl.DateTimeFormat('en-PH', {
    timeZone: 'Asia/Manila',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(s));
export const localNow = () => new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 16);
export const toISO = (s: string) => new Date(s + '+08:00').toISOString();
export const key = () => crypto.randomUUID();
