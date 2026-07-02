import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { apiGet, apiPost, apiUpload } from './api';
import { IconMenu, IconPlus, IconArrowUp } from './Icons';
import { TopBar, IconButton } from './Shell';
import { MessageRow } from './ChatMessage';
import { subscribeLocalMessages } from './api/localEcho';
import { addFavorite } from './api/favoritesStore';

interface ChatRecord { ts: string; role: 'user' | 'assistant' | 'command'; text: string; source?: string; attachments?: { filename: string; url: string; size?: number }[]; quoted_ts?: string; quoted_text?: string; }
interface ChatStatus { is_typing?: boolean; active_session?: string; active_conversation?: string; since?: string | null }

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
  { cmd: '/restart', desc: '重启 Claude（清空上下文，保留会话）', icon: '↻' },
  { cmd: '/kill', desc: '结束当前 Claude 进程', icon: '×' },
  { cmd: '/claude', desc: '启动 Claude', icon: '▶' },
];

export default function ChatView({ openSidebar, showToast }: { openSidebar: () => void; showToast?: (m: string, t?: string) => void }) {
  const [records, setRecords] = useState<ChatRecord[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [lastTs, setLastTs] = useState<string | null>(null);
  const [status, setStatus] = useState<ChatStatus>({});
  const [showCmds, setShowCmds] = useState(false);
  const [cmdFilter, setCmdFilter] = useState('');
  const [quoting, setQuoting] = useState<{ ts: string; text: string } | null>(null);
  const [menu, setMenu] = useState<{ m: ChatRecord; x: number; y: number } | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [hidden, setHidden] = useState<Set<string>>(() => { try { return new Set(JSON.parse(localStorage.getItem('cc_hidden_msgs') || '[]')); } catch { return new Set(); } });
  const logRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [localMsgs, setLocalMsgs] = useState<ChatRecord[]>([]);
  useEffect(() => subscribeLocalMessages(m => setLocalMsgs(m as ChatRecord[])), []);

  const filteredRecords = useMemo(() => {
    const merged = [...records, ...localMsgs];
    merged.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
    const seen = new Set<string>();
    return merged.filter(r => {
      if (seen.has(r.ts)) return false;
      seen.add(r.ts);
      return !hidden.has(r.ts) && !isNoiseRecord(r);
    });
  }, [records, localMsgs, hidden]);

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

  const pollStatus = useCallback(async () => {
    try {
      const data = await apiGet('/chat/status');
      if (data.ok) setStatus(data);
    } catch {}
  }, []);

  useEffect(() => { pollStatus(); const i = setInterval(pollStatus, 1500); return () => clearInterval(i); }, [pollStatus]);
  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, [filteredRecords, status.is_typing]);

  const reloadActiveConversation = useCallback(async () => {
    setRecords([]);
    setLastTs(null);
    try {
      const data = await apiGet('/chat/history?limit=200');
      if (data.ok && Array.isArray(data.records)) {
        setRecords(data.records);
        if (data.records.length > 0) setLastTs(data.records[data.records.length - 1].ts);
      }
    } catch {}
  }, []);

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
        case '/new': { const d = await apiPost('/chain/new_session', { name: arg }); await reloadActiveConversation(); showToast?.(`新会话: ${d.session}`, 'success'); return; }
        case '/list': { const d = await apiGet('/chain/sessions'); appendLocal('command', d.sessions.map((s: string) => `${s === d.active ? '→ ' : '  '}${s}`).join('\n')); return; }
        case '/switch': { if (!arg) { appendLocal('command', '用法: /switch <name>'); return; } const d = await apiPost('/chain/switch', { session: arg }); await reloadActiveConversation(); showToast?.(`已切换: ${d.active}`, 'success'); return; }
        case '/stop': await apiPost('/chain/abort', {}); appendLocal('command', '已发送 Ctrl+C'); return;
        case '/clear': await apiPost('/tmux/send', { keys: 'clear', enter: true }); appendLocal('command', '已清屏'); return;
        case '/compact': await apiPost('/tmux/send', { keys: '/compact', enter: true }); appendLocal('command', '已发送 /compact'); return;
        case '/restart': await apiPost('/chain/restart', {}); appendLocal('command', '已重启 Claude（上下文已清空，会话保留）'); return;
        case '/kill': await apiPost('/chain/kill', {}); appendLocal('command', '已结束当前 Claude 进程'); return;
        case '/claude': await apiPost('/tmux/send', { keys: 'claude', enter: true }); appendLocal('command', '已启动 Claude'); return;
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
    try {
      await apiPost('/chat/send', { text, quoted_ts: quoting?.ts });
      setStatus(prev => ({ ...prev, is_typing: true, since: new Date().toISOString() }));
      setInput('');
      setQuoting(null);
      await poll();
    } catch (e) { alert(`发送失败: ${e}`); } finally { setSending(false); }
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

  const startQuote = (m: ChatRecord) => { setQuoting({ ts: m.ts, text: m.text.replace(/\s+/g, ' ').trim().slice(0, 50) }); textareaRef.current?.focus(); };
  const favoriteMessages = (msgs: ChatRecord[]) => {
    if (!msgs.length) return;
    addFavorite(msgs.map(m => ({ ts: m.ts, role: m.role, text: m.text })));
    showToast?.(msgs.length >= 2 ? `已收藏 ${msgs.length} 条` : '已收藏', 'success');
  };
  // Frontend-only delete: hide locally (persisted). The server JSONL is just the
  // phone's display record — Claude reads the tmux session, not this — so hiding
  // is equivalent in effect and survives backend outages.
  const deleteMessages = (tss: string[]) => {
    setHidden(prev => {
      const n = new Set(prev);
      tss.forEach(t => n.add(t));
      localStorage.setItem('cc_hidden_msgs', JSON.stringify([...n].slice(-2000)));
      return n;
    });
  };
  const toggleSelect = (m: ChatRecord) => setSelected(prev => { const n = new Set(prev); if (n.has(m.ts)) n.delete(m.ts); else n.add(m.ts); return n; });
  const exitSelect = () => { setSelectMode(false); setSelected(new Set()); };
  const selectedMsgs = filteredRecords.filter(r => selected.has(r.ts));

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
        {filteredRecords.map(r => <MessageRow key={r.ts} r={r} showToast={showToast} onLongPress={(m, x, y) => setMenu({ m, x, y })} selectMode={selectMode} selected={selected.has(r.ts)} onToggleSelect={toggleSelect} />)}
        {status.is_typing && (
          <div className="msg-assistant ai-typing-row" aria-live="polite">
            <div className="msg-assistant-head">
              <div className="msg-assistant-avatar">C</div>
              <span className="msg-assistant-name">Claude</span>
            </div>
            <div className="ai-typing-bubble">
              <span className="thinking-dot" /><span className="thinking-dot" /><span className="thinking-dot" />
              <span>正在输入</span>
            </div>
          </div>
        )}
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

      {menu && (
        <div className="msg-menu-scrim" onClick={() => setMenu(null)}>
          <div className="msg-menu" style={{ left: Math.min(menu.x, window.innerWidth - 152), top: Math.min(menu.y, window.innerHeight - 210) }} onClick={e => e.stopPropagation()}>
            <button onClick={() => { startQuote(menu.m); setMenu(null); }}>引用</button>
            <button onClick={() => { favoriteMessages([menu.m]); setMenu(null); }}>收藏</button>
            <button onClick={() => { setSelectMode(true); setSelected(new Set([menu.m.ts])); setMenu(null); }}>多选</button>
            <button className="danger" onClick={() => { deleteMessages([menu.m.ts]); setMenu(null); }}>删除</button>
          </div>
        </div>
      )}

      {selectMode ? (
        <div className="msg-select-bar">
          <span className="msg-select-count">已选 {selected.size} 条</span>
          <button disabled={!selected.size} onClick={() => { favoriteMessages(selectedMsgs); exitSelect(); }}>收藏</button>
          <button className="danger" disabled={!selected.size} onClick={() => { deleteMessages([...selected]); exitSelect(); }}>删除</button>
          <button onClick={exitSelect}>取消</button>
        </div>
      ) : (
      <div className="composer-wrap">
        <input type="file" ref={fileRef} style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) uploadFile(f); e.target.value = ''; }} />
        {quoting && (
          <div className="composer-quote">
            <span className="composer-quote-text">引用：{quoting.text}</span>
            <button className="composer-quote-x" onClick={() => setQuoting(null)} aria-label="取消引用">✕</button>
          </div>
        )}
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
      )}
    </>
  );
}
