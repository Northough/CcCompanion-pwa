// Local, persisted chat echoes — used when the server isn't reachable so a
// command receipt (完成/取消/超时) still stays in the chat instead of a toast.
export interface LocalMsg {
  ts: string;
  role: 'user' | 'assistant' | 'command';
  text: string;
  quoted_text?: string;
}

const KEY = 'cc_local_echo_v1';

function load(): LocalMsg[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

let messages: LocalMsg[] = load();
const listeners = new Set<(messages: LocalMsg[]) => void>();

function persist() {
  messages = messages.slice(-200);
  localStorage.setItem(KEY, JSON.stringify(messages));
}

let lastMs = 0;
function nextTs(): string {
  let now = Date.now();
  if (now <= lastMs) now = lastMs + 1;
  lastMs = now;
  return new Date(now).toISOString();
}

export function addLocalMessage(role: LocalMsg['role'], text: string, extra?: { quoted_text?: string }): LocalMsg {
  const msg: LocalMsg = { ts: nextTs(), role, text, ...extra };
  messages.push(msg);
  persist();
  const snapshot = [...messages];
  listeners.forEach(listener => listener(snapshot));
  return msg;
}

export function clearLocalMessages() {
  messages = [];
  localStorage.removeItem(KEY);
  listeners.forEach(listener => listener([]));
}

export function subscribeLocalMessages(cb: (messages: LocalMsg[]) => void) {
  listeners.add(cb);
  cb([...messages]);
  return () => {
    listeners.delete(cb);
  };
}
