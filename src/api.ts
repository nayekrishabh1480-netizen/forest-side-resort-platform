export function resolveApiBase(value?: string): string {
  const base = (value || 'http://localhost:4000/api/v1').replace(/\/+$/, '');
  return base.endsWith('/api/v1') ? base : `${base}/api/v1`;
}

const API_BASE = resolveApiBase(import.meta.env.VITE_API_BASE_URL);

export class ApiError extends Error {
  code: string;
  status: number;
  constructor(message: string, code: string, status: number) { super(message); this.name = 'ApiError'; this.code = code; this.status = status; }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...init,
      credentials: 'include',
      headers: { ...(init.body instanceof FormData ? {} : { 'content-type': 'application/json' }), ...init.headers },
    });
  } catch {
    throw new ApiError('The resort service could not be reached. Please try again shortly.', 'NETWORK_ERROR', 0);
  }
  if (response.status === 204) return undefined as T;
  const contentType = response.headers.get('content-type') || '';
  if (!response.ok) {
    const body = contentType.includes('application/json') ? await response.json().catch(() => ({})) : {};
    const error = body.error || {};
    throw new ApiError(error.message || friendlyError(error.code) || `Request failed (${response.status}).`, error.code || 'REQUEST_FAILED', response.status);
  }
  if (!contentType.includes('application/json')) throw new ApiError('The service returned an unexpected response.', 'INVALID_RESPONSE', response.status);
  const body = await response.json();
  if (Object.prototype.hasOwnProperty.call(body, 'data')) {
    const extras = Object.fromEntries(Object.entries(body).filter(([key]) => key !== 'data'));
    if (Object.keys(extras).length && body.data && typeof body.data === 'object' && !Array.isArray(body.data)) return { ...body.data, ...extras } as T;
    return body.data as T;
  }
  return body as T;
}

function friendlyError(code?: string) {
  const messages: Record<string, string> = {
    INVALID_STAY_DATES: 'Choose valid future check-in and check-out dates.',
    GUEST_COUNT_EXCEEDS_CAPACITY: 'This room category cannot accommodate that number of guests.',
    ROOM_DATE_CONFLICT: 'That room is no longer available for those dates.',
    AUTHENTICATION_REQUIRED: 'Please sign in to continue.',
    INVALID_CREDENTIALS: 'The email or password was not accepted.',
    GUEST_OPT_IN_REQUIRED: 'The guest has not opted in to WhatsApp notifications.',
  };
  return code ? messages[code] : undefined;
}

export const API_URL = API_BASE;

export function safeExternalUrl(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  try { const parsed = new URL(value); return parsed.protocol === 'https:' && !parsed.username && !parsed.password ? value : fallback; } catch { return fallback; }
}
