import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { apiGet, apiPost, apiUpload } from './api';
import { IconMenu, IconPlus, IconArrowUp } from './Icons';
import { TopBar, IconButton } from './Shell';
import { MessageRow } from './ChatMessage';

interface ChatRecord { ts: string; role: 'user' | 'assistant' | 'command'; text: string; source?: string; attachments?: { filename: string; url: string; size?: number }[]; }

const NOISE = ['Welcome to Claude Code', 'Welcome back', 'Checking connectivity', '╭─', '╰─', '│', 'Claude Code v', 'Organization'];
const SHELL_PROMPTS = ['$', '%', '#', '❯', '~]#', ']$'];

function isNoiseRecord(r: ChatRecord): boolean {
  if (r.role !== 'assistant') return false;
  const t = r.text.trim();
  if (!t || t.length < 2) return true;
  for (const n of NOISE) if (t.includes(n)) return true;
  const lines = t.split('\n');
  if (lines.length === 1) { for (const p of SHELL_PROMPTS) if (lines[0].trim().endsWith(p)) return true; }
  return false;
}

const COMMANDS = [
  { cmd: '/help', desc: '显示命令列表', icon: '?' },
  { cmd: '/new', desc: '创建新 tmux 会话', icon: '+' },
  { cmd: '/list', desc: '列出所有会话', icon: '≡' },
  { cmd: '/switch', desc: '切换到指定会话', icon: '⇄' },
  { cmd: '/stop', desc: '中止 Claude (Ctrl+C)', icon: '■' },
  { cmd: '/clear', desc: '清空终端屏幕', icon: '⌫' },
  { cmd: '/compact', desc: '压缩 Claude 上下文', icon: '⊟' },
];

export default function ChatView({ openSidebar, showToast }: { openSidebar: () => void; showToast?: (m: string, t?: string) => void }) {
  const [records, setRecords] = useState<ChatRecord[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [lastTs, setLastTs] = useState<string | null>(null);
  const [showCmds, setShowCmds] = useState(false);
  const [cmdFilter, setCmdFilter] = useState('');
  const logRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const filteredRecords = useMemo(() => records.filter(r => !isNoiseRecord(r)), [records]);

  const appendLocal = useCallback((role: ChatRecord['role'], text: string, attachments?: ChatRecord['attachments']) => {
    setRecords(prev => [...prev, { ts: new Date().toISOString(), role, text, attachments }]);
  }, []);

  const poll = useCallback(async () => {
    try {
      const path = lastTs ? `/chat/history?since=${encodeURIComponent(lastTs)}` : '/chat/history?limit=200';
      const data = await apiGet(path);
      if (data.ok && Array.isArray(data.records)) {
        setRecords(prev => {
          const seen = new Set(prev.map(r => r.ts));
          const fresh = data.records.filter((r: ChatRecord) => !seen.has(r.ts));
          return fresh.length ? [...prev, ...fresh] : prev;
        });
        if (data.records.length > 0) setLastTs(data.records[data.records.length - 1].ts);
      }
    } catch {}
  }, [lastTs]);

  useEffect(() => { poll(); const i = setInterval(poll, 2000); return () => clearInterval(i); }, [poll]);
  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, [filteredRecords]);

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 140) + 'px';
  }, [input]);

  const handleSlash = async (cmd: string, arg: string) => {
    try {
      switch (cmd) {
        case '/help': appendLocal('command', COMMANDS.map(c => `${c.cmd} — ${c.desc}`).join('\n')); return;
        case '/new': { const d = await apiPost('/chain/new_session', { name: arg }); appendLocal('command', `已创建: ${d.session}，Claude 已启动`); return; }
        case '/list': { const d = await apiGet('/chain/sessions'); appendLocal('command', d.sessions.map((s: string) => `${s === d.active ? '→ ' : '  '}${s}`).join('\n')); return; }
        case '/switch': { if (!arg) { appendLocal('command', '用法: /switch <name>'); return; } const d = await apiPost('/chain/switch', { session: arg }); appendLocal('command', `已切换: ${d.active}`); return; }
        case '/stop': await apiPost('/chain/abort', {}); appendLocal('command', '已发送 Ctrl+C'); return;
        case '/clear': await apiPost('/tmux/send', { keys: 'clear', enter: true }); appendLocal('command', '已清屏'); return;
        case '/compact': await apiPost('/tmux/send', { keys: '/compact', enter: true }); appendLocal('command', '已发送 /compact'); return;
        default: appendLocal('command', `未知命令: ${cmd}，输入 /help`); return;
      }
    } catch (e) { appendLocal('command', `命令失败: ${e}`); }
  };

  const onInputChange = (val: string) => {
    setInput(val);
    setShowCmds(val.startsWith('/'));
    if (val.startsWith('/')) setCmdFilter(val.slice(1).toLowerCase());
  };

  const send = async () => {
    const text = input.trim();
    if (!text || sending) return;
    setShowCmds(false);
    if (text.startsWith('/')) { setInput(""); const [cmd, ...rest] = text.split(/\s+/); await handleSlash(cmd.toLowerCase(), rest.join(' ')); return; }
    setSending(true);
    try { await apiPost('/chat/send', { text }); setInput(''); await poll(); } catch (e) { alert(`发送失败: ${e}`); } finally { setSending(false); }
  };

  const uploadFile = async (file: File) => {
    const fd = new FormData(); fd.append('file', file);
    try {
      const d = await apiUpload('/chat/upload', fd);
      if (d.ok) {
        const atts = (d.files || []).map((f: any) => ({ filename: f.filename, url: f.attachment_url, size: file.size }));
        appendLocal('user', '', atts);
        await poll();
      }
    } catch (e) { alert(`上传失败: ${e}`); }
  };

  const visibleCmds = COMMANDS.filter(c => !cmdFilter || c.cmd.includes(cmdFilter) || c.desc.includes(cmdFilter));

  return (
    <>
      <TopBar left={<IconButton onClick={openSidebar}><IconMenu /></IconButton>} center={<span className="topbar-title">Chat</span>} right={<span style={{ width: 42 }} />} />

      <div className="chat-scroll" ref={logRef}>
        {filteredRecords.length === 0 && (
          <div style={{ textAlign: 'center', color: 'var(--dim)', padding: '40px 20px' }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)', marginBottom: 4 }}>Cc Companion</div>
            <div style={{ fontSize: 13 }}>发一条消息给 Claude</div>
          </div>
        )}
        {filteredRecords.length > 0 && (
          <div className="chat-day"><div className="chat-day-line" /><span className="chat-day-label">Today</span><div className="chat-day-line" /></div>
        )}
        {filteredRecords.map(r => <MessageRow key={r.ts} r={r} showToast={showToast} />)}
      </div>

      {showCmds && visibleCmds.length > 0 && (
        <div className="cmd-popup">
          {visibleCmds.map(c => (
            <button key={c.cmd} className="cmd-item" onClick={() => { setInput(c.cmd + ' '); setShowCmds(false); }}>
              <span className="cmd-icon">{c.icon}</span>
              <span className="cmd-name">{c.cmd}</span>
              <span className="cmd-desc">{c.desc}</span>
            </button>
          ))}
        </div>
      )}

      <div className="composer-wrap">
        <input type="file" ref={fileRef} style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) uploadFile(f); e.target.value = ''; }} />
        <div className="composer-box">
          <button className="icon-btn" onClick={() => fileRef.current?.click()} aria-label="Attach"><IconPlus size={22} /></button>
          <textarea ref={textareaRef} className="composer-textarea" value={input} onChange={e => onInputChange(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !(e as any).isComposing) { e.preventDefault(); send(); } if (e.key === 'Escape') setShowCmds(false); }}
            placeholder="说点什么... /help 看命令" rows={1} />
          <button className={`composer-send ${sending ? 'disabled' : input.trim() ? 'active' : 'disabled'}`} onClick={send} disabled={sending || !input.trim()}
            aria-label={sending ? 'Sending' : 'Send'}>
            <IconArrowUp size={18} />
          </button>
        </div>
      </div>
    </>
  );
}
