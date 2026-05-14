const DEFAULT_API_BASE = import.meta.env.VITE_API_BASE || '';

function resolveBaseUrl(): string {
  const saved = localStorage.getItem('cc_server_url');
  if (saved) return saved.replace(/\/+$/, '');
  return DEFAULT_API_BASE;
}

export async function apiFetch(path: string, options: RequestInit = {}) {
  const secret = localStorage.getItem('cc_shared_secret') || '';
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string> || {}),
  };
  if (secret) {
    headers['X-Auth-Token'] = secret;
  }
  const base = resolveBaseUrl();
  const url = `${base}${path}`;
  const res = await fetch(url, { ...options, headers });
  if (!res.ok) {
    throw new Error(`API ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

export async function apiUpload(path: string, formData: FormData) {
  const secret = localStorage.getItem('cc_shared_secret') || '';
  const headers: Record<string, string> = {};
  if (secret) {
    headers['X-Auth-Token'] = secret;
  }
  const base = resolveBaseUrl();
  const res = await fetch(`${base}${path}`, { method: 'POST', headers, body: formData });
  if (!res.ok) {
    throw new Error(`API ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

export async function apiGet(path: string) {
  return apiFetch(path, { cache: 'no-store' });
}

export async function apiPost(path: string, body: unknown) {
  return apiFetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function getServerUrl(): string {
  return localStorage.getItem('cc_server_url') || DEFAULT_API_BASE || '';
}

export function setServerUrl(url: string) {
  localStorage.setItem('cc_server_url', url);
}

export function getSecret(): string {
  return localStorage.getItem('cc_shared_secret') || '';
}

export function setSecret(secret: string) {
  localStorage.setItem('cc_shared_secret', secret);
}
