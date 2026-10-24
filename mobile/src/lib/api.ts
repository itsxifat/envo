/**
 * Envo's API. In development the emulator reaches the Mac through `adb reverse tcp:4310 tcp:4310`;
 * a release build talks to envo.enfinito.cloud. EXPO_PUBLIC_API_URL overrides both.
 */
export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? (__DEV__ ? 'http://localhost:4310/api' : 'https://envo.enfinito.cloud/api');

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    /** e.g. "business_account" when a business login tries the app. */
    public code?: string,
  ) {
    super(message);
  }
}

let token: string | null = null;
let onSignedOut: (() => void) | null = null;

/** The sign-in sent with every request; `signedOut` runs when the server no longer accepts it. */
export function setToken(next: string | null, signedOut?: () => void): void {
  token = next;
  if (signedOut) onSignedOut = signedOut;
}

/** Throws the server's error; a 401 outside sign-in means the saved sign-in no longer works. */
function fail(status: number, data: { error?: string; details?: { code?: string } } | null, signIn = false): never {
  if (status === 401 && token && !signIn) onSignedOut?.();
  throw new ApiError(status, data?.error ?? 'Something went wrong. Please try again.', data?.details?.code);
}

export interface RequestOptions {
  /** Uploads only: how much has been sent, from 0 to 1. */
  onProgress?: (fraction: number) => void;
}

/**
 * Uploads (photos, documents) go through XMLHttpRequest: Expo's fetch can't send React Native's
 * { uri, name, type } file parts, the native XMLHttpRequest reads them from disk.
 */
function upload<T>(method: string, path: string, body: FormData, onProgress?: (fraction: number) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open(method, API_URL + path);
    x.setRequestHeader('Accept', 'application/json');
    if (token) x.setRequestHeader('Authorization', `Bearer ${token}`);
    x.timeout = 120_000;
    if (onProgress) {
      x.upload.onprogress = (e) => {
        if (e.lengthComputable && e.total > 0) onProgress(Math.min(1, e.loaded / e.total));
      };
    }
    x.onload = () => {
      let data: { error?: string; details?: { code?: string } } | null = null;
      try {
        data = JSON.parse(x.responseText);
      } catch {
        // not JSON
      }
      if (x.status >= 200 && x.status < 300) resolve(data as T);
      else {
        try {
          fail(x.status, data);
        } catch (err) {
          reject(err);
        }
      }
    };
    x.onerror = () => reject(new ApiError(0, "Can't reach Envo. Check your internet connection and try again."));
    x.ontimeout = () => reject(new ApiError(0, 'Sending took too long. Check your connection and try again.'));
    x.send(body);
  });
}

async function request<T>(method: string, path: string, body?: unknown, opts: RequestOptions = {}): Promise<T> {
  if (body instanceof FormData) return upload<T>(method, path, body, opts.onProgress);
  // A weak connection can leave a request hanging: give up after 20 s, the answer's body included.
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 20_000);
  let res: Response;
  let text: string;
  try {
    res = await fetch(API_URL + path, {
      method,
      headers: {
        Accept: 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: abort.signal,
    });
    text = await res.text();
  } catch (err) {
    if (__DEV__) console.warn('[api]', method, path, err);
    throw new ApiError(0, abort.signal.aborted ? 'Envo is taking too long to answer. Check your internet connection and try again.' : "Can't reach Envo. Check your internet connection and try again.");
  } finally {
    clearTimeout(timer);
  }
  let data: { error?: string; details?: { code?: string } } | null = null;
  try {
    data = JSON.parse(text);
  } catch {
    // not JSON
  }
  if (!res.ok) fail(res.status, data, path.startsWith('/public/'));
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body: unknown = {}, opts?: RequestOptions) => request<T>('POST', path, body, opts),
  put: <T>(path: string, body: unknown) => request<T>('PUT', path, body),
};

/** Server messages start with the field ("details: enter…"); people only need the sentence. */
export function errorText(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  const clean = msg.replace(/^[a-z_.]+: /, '');
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}
