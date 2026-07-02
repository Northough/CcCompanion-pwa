// Local, no-backend command store.
// Commands are issued by Claude embedding a [[task:标题:秒]] marker in its chat
// reply; ChatView parses it and calls addCommand(). State lives in localStorage
// so an in-progress countdown survives a page refresh. Completion/cancel is
// reported back to Claude as a normal chat message (see ChatView.onResolved).

export interface CommandItem {
  id: string | number;
  title: string;
  countdown_seconds: number | null;
  created_at: number;
  started_at: number | null;
  completed_at: number | null;
  duration_ms?: number | null;
  vs_countdown_ms?: number | null;
  outcome?: string | null;
  created_by?: string;
  owner_agent?: string | null;
  feedback_text?: string | null;
}

const STORE_KEY = 'cc_commands_v1';
const SEEN_KEY = 'cc_commands_seen_v1';

function loadStore(): CommandItem[] {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) || '[]');
    return Array.isArray(raw) ? raw.filter((c: CommandItem) => !c.completed_at) : [];
  } catch {
    return [];
  }
}

function loadSeen(): Set<string> {
  try {
    const raw = JSON.parse(localStorage.getItem(SEEN_KEY) || '[]');
    return new Set(Array.isArray(raw) ? raw : []);
  } catch {
    return new Set();
  }
}

let commands: CommandItem[] = loadStore();
const seen: Set<string> = loadSeen();
const listeners = new Set<(commands: CommandItem[]) => void>();

function persist() {
  localStorage.setItem(STORE_KEY, JSON.stringify(commands));
}

function persistSeen() {
  localStorage.setItem(SEEN_KEY, JSON.stringify([...seen].slice(-500)));
}

function pending(): CommandItem[] {
  return commands.filter(command => !command.completed_at);
}

function emit() {
  const snapshot = pending();
  listeners.forEach(listener => listener(snapshot));
}

/** Issue a command from a parsed chat marker. `key` de-dupes re-scans/reloads. */
export function addCommand(key: string, spec: { title: string; countdown_seconds?: number | null }): CommandItem | null {
  if (seen.has(key)) return null;
  seen.add(key);
  persistSeen();
  const countdown = Number(spec.countdown_seconds);
  const command: CommandItem = {
    id: key,
    title: spec.title.trim() || '收到一个新任务',
    countdown_seconds: Number.isFinite(countdown) && countdown > 0 ? countdown : null,
    created_at: Date.now(),
    started_at: null,
    completed_at: null,
    duration_ms: null,
    vs_countdown_ms: null,
    outcome: null,
    created_by: 'claude',
  };
  commands.push(command);
  persist();
  emit();
  return command;
}

export async function startCommand(id: string | number): Promise<CommandItem | null> {
  const command = commands.find(item => String(item.id) === String(id));
  if (!command) return null;
  if (!command.started_at) {
    command.started_at = Date.now();
    persist();
    emit();
  }
  return { ...command };
}

export async function completeCommand(id: string | number, outcome: string = 'completed'): Promise<CommandItem | null> {
  const command = commands.find(item => String(item.id) === String(id));
  if (!command) return null;
  const completedAt = Date.now();
  const startedAt = command.started_at || completedAt;
  command.started_at = startedAt;
  command.completed_at = completedAt;
  command.duration_ms = completedAt - startedAt;
  command.vs_countdown_ms = command.countdown_seconds ? command.duration_ms - command.countdown_seconds * 1000 : null;
  command.outcome = outcome;
  const result = { ...command };
  commands = commands.filter(item => String(item.id) !== String(id));
  persist();
  emit();
  return result;
}

export function subscribeCommands(onPending: (commands: CommandItem[]) => void, _onError?: (error: unknown) => void) {
  listeners.add(onPending);
  onPending(pending());
  maybeScheduleDemo();
  return () => {
    listeners.delete(onPending);
  };
}

// Optional demo command for UI-only testing without Claude/server.
// Enabled via Settings ("演示模式") → localStorage 'cc_command_transport' === 'mock'.
let demoScheduled = false;
function maybeScheduleDemo() {
  if (demoScheduled) return;
  if (localStorage.getItem('cc_command_transport') !== 'mock') return;
  demoScheduled = true;
  window.setTimeout(() => {
    addCommand(`demo-${Date.now()}`, { title: '读完这一段，再点完成', countdown_seconds: 150 });
  }, 3500);
}
