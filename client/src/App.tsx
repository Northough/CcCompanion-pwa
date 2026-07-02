import { useState, useCallback, useEffect } from 'react';
import ChatView from './ChatView';
import TerminalView from './TerminalView';
import UsageView from './UsageView';
import SettingsView from './SettingsView';
import GroupView from './GroupView';
import StudyView from './StudyView';
import ScheduleView from './features/functions/ScheduleView';
import FavoritesView from './FavoritesView';
import { Sidebar } from './Sidebar';
import { NavHandle, Toast } from './Shell';
import { apiGet, apiPost } from './api';
import { addCommand, type CommandItem } from './api/commandTransport';
import { addLocalMessage } from './api/localEcho';
import CommandFloatWindow, { type CommandOutcome } from './components/CommandFloatWindow';
import './App.css';

type Page = 'chat' | 'terminal' | 'usage' | 'settings' | 'schedule' | 'group' | 'study' | 'favorites';

function fmtDur(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}分${s % 60}秒` : `${s}秒`;
}

function buildResolveText(cmd: CommandItem, outcome: CommandOutcome): string {
  if (outcome === 'timeout') return `⏱ 『${cmd.title}』超时一小时未响应，已自动结束任务`;
  if (outcome === 'canceled') return `✕ 取消了『${cmd.title}』`;
  let text = `✓ 完成了『${cmd.title}』`;
  if (cmd.duration_ms) text += ` · 用时 ${fmtDur(cmd.duration_ms)}`;
  if (cmd.vs_countdown_ms != null) {
    text += cmd.vs_countdown_ms <= 0 ? ` · 比预定快 ${fmtDur(-cmd.vs_countdown_ms)}` : ` · 超时 ${fmtDur(cmd.vs_countdown_ms)}`;
  }
  return text;
}

function App() {
  const [page, setPage] = useState<Page>('chat');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [chatReloadKey, setChatReloadKey] = useState(0);
  const [toast, setToast] = useState({ message: '', tone: '', key: 0 });

  const showToast = useCallback((message: string, tone = '') => {
    setToast({ message, tone, key: Date.now() });
    setTimeout(() => setToast(t => ({ ...t, message: '' })), 1800);
  }, []);

  const goto = useCallback((p: Page) => { setPage(p); setSidebarOpen(false); }, []);
  const refreshChat = useCallback(() => setChatReloadKey(k => k + 1), []);

  const handleCommandResolved = useCallback(async (cmd: CommandItem, outcome: CommandOutcome) => {
    const text = buildResolveText(cmd, outcome);
    try {
      await apiPost('/chat/send', { text });
    } catch {
      addLocalMessage('user', text); // server unreachable — keep the receipt in the chat (persisted)
    }
  }, []);

  // Global poll for [[task:标题:秒]] markers in Claude's replies → pop the float window on any page
  useEffect(() => {
    let last: string | null = null;
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      try {
        const path = last ? `/chat/history?since=${encodeURIComponent(last)}` : '/chat/history?limit=50';
        const d = await apiGet(path);
        if (d.ok && Array.isArray(d.records)) {
          for (const r of d.records as { ts: string; role: string; text: string }[]) {
            if (r.role === 'assistant') {
              let i = 0;
              for (const m of r.text.matchAll(/\[\[task:\s*([^\]:]+?)\s*(?::\s*(\d+))?\s*\]\]/g)) {
                addCommand(`${r.ts}#${i++}`, { title: m[1], countdown_seconds: m[2] ? Number(m[2]) : null });
              }
            }
            last = r.ts;
          }
        }
      } catch {}
      if (!stop) timer = setTimeout(tick, 3000);
    };
    tick();
    return () => { stop = true; if (timer) clearTimeout(timer); };
  }, []);
  const pageView = (() => {
    switch (page) {
      case 'chat': return <ChatView key={chatReloadKey} openSidebar={() => setSidebarOpen(true)} showToast={showToast} />;
      case 'terminal': return <TerminalView openSidebar={() => setSidebarOpen(true)} />;
      case 'study': return <StudyView openSidebar={() => setSidebarOpen(true)} showToast={showToast} />;
      case 'schedule': return <ScheduleView openSidebar={() => setSidebarOpen(true)} showToast={showToast} />;
      case 'favorites': return <FavoritesView openSidebar={() => setSidebarOpen(true)} showToast={showToast} />;
      case 'usage': return <UsageView openSidebar={() => setSidebarOpen(true)} showToast={showToast} />;
      case 'settings': return <SettingsView openSidebar={() => setSidebarOpen(true)} showToast={showToast} />;
      case 'group': return <GroupView openSidebar={() => setSidebarOpen(true)} showToast={showToast} />;
      default: return null;
    }
  })();

  return (
    <div className="device">
      <div className="page-shell">{pageView}</div>

      <NavHandle />

      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} page={page} goto={goto} showToast={showToast} onChatChanged={refreshChat} />

      <CommandFloatWindow showToast={showToast} onResolved={handleCommandResolved} />

      <Toast key={toast.key} message={toast.message} tone={toast.tone} />
    </div>
  );
}

export default App;
