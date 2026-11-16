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
  const response = await fetch('/api' + path, {
    method,
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...(csrf ? { 'X-CSRF-Token': csrf } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok)
    throw new APIError(
      result.error +
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
