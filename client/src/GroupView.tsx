import { useState, useRef, useEffect, useCallback } from 'react';
import { apiGet, apiPost } from './api';
import { IconMenu, IconArrowUp, IconUsers } from './Icons';
import { TopBar, IconButton } from './Shell';

/* ── Types ── */

interface RosterMember { id: string; name?: string; display_name?: string; color?: string; model?: string; kind?: string }
interface GroupRecord {
  ts: string;
  sender_id: string;
  text: string;
  message_type?: string;
  mentions?: string[];
  task_id?: string;
  delivery_targets?: string[];
}

/* ── Helpers ── */

function fmtTime(ts: string) {
  try { return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); } catch { return ts.slice(11, 16); }
}

const SENDER_COLORS: Record<string, string> = {};

function senderColor(id: string, roster: RosterMember[]): string {
  if (SENDER_COLORS[id]) return SENDER_COLORS[id];
  const m = roster.find(r => r.id === id);
  const c = m?.color || '#888';
  SENDER_COLORS[id] = c;
  return c;
}

function memberName(member?: RosterMember): string {
  return member?.name || member?.display_name || member?.id || 'Unknown';
}

/* ── @Mention autocomplete ── */

function MentionPopup({ roster, filter, onSelect }: { roster: RosterMember[]; filter: string; onSelect: (id: string) => void }) {
  const filtered = roster.filter(r => r.id !== 'user' && (
    !filter || r.id.toLowerCase().includes(filter.toLowerCase()) || memberName(r).toLowerCase().includes(filter.toLowerCase())
  ));
  if (filtered.length === 0) return null;
  return (
    <div className="cmd-popup" style={{ margin: '0 14px 4px' }}>
      {filtered.map(r => (
        <button key={r.id} className="cmd-item" onClick={() => onSelect(r.id)}>
          <span className="cmd-icon" style={{ background: r.color || '#888', color: '#fff', fontSize: 11 }}>{memberName(r)[0]}</span>
          <span className="cmd-name">@{r.id}</span>
          <span className="cmd-desc">{memberName(r)}</span>
        </button>
      ))}
    </div>
  );
}

/* ── Main Component ── */

export default function GroupView({ openSidebar, showToast }: { openSidebar: () => void; showToast?: (m: string, t?: string) => void }) {
  const [records, setRecords] = useState<GroupRecord[]>([]);
  const [roster, setRoster] = useState<RosterMember[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [lastTs, setLastTs] = useState<string | null>(null);
  const [online, setOnline] = useState<Record<string, string>>({});
  const [typing, setTyping] = useState<Record<string, string>>({});

  // @mention state
  const [showMentions, setShowMentions] = useState(false);
  const [mentionFilter, setMentionFilter] = useState('');

  const logRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const typingSentRef = useRef(false);
  const typingClearRef = useRef<number | null>(null);
  const senderId = 'user';  // This PWA always sends as "user"

  /* ── Poll roster ── */
  const pollRoster = useCallback(async () => {
    try {
      const d = await apiGet('/group/roster');
      if (d.ok) {
        setRoster(d.roster || []);
        setOnline(d.online || {});
        setTyping(d.typing || {});
      }
    } catch {}
  }, []);

  /* ── Poll messages ── */
  const pollMessages = useCallback(async () => {
    try {
      const path = lastTs
        ? `/group/poll?since=${encodeURIComponent(lastTs)}&limit=200&sender_id=${encodeURIComponent(senderId)}`
        : `/group/poll?limit=200&sender_id=${encodeURIComponent(senderId)}`;
      const d = await apiGet(path);
      if (d.ok && Array.isArray(d.records)) {
        setRecords(prev => {
          const seen = new Set(prev.map(r => r.ts));
          const fresh = d.records.filter((r: GroupRecord) => !seen.has(r.ts));
          return fresh.length ? [...prev, ...fresh] : prev;
        });
        if (d.records.length > 0) setLastTs(d.records[d.records.length - 1].ts);
      }
    } catch {}
  }, [lastTs]);

  /* ── Heartbeat ── */
  const heartbeat = useCallback(async () => {
    try { await apiPost('/group/roster_heartbeat', { sender_id: senderId }); } catch {}
  }, []);

  /* ── Effects ── */
  useEffect(() => {
    pollRoster();
    pollMessages();
    heartbeat();
    const i1 = setInterval(pollMessages, 2000);
    const i2 = setInterval(pollRoster, 5000);
    const i3 = setInterval(heartbeat, 15000);
    return () => { clearInterval(i1); clearInterval(i2); clearInterval(i3); };
  }, [pollRoster, pollMessages, heartbeat]);

  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, [records]);

  /* ── Auto-resize textarea ── */
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 140) + 'px';
  }, [input]);

  /* ── Handle input for @mentions ── */
  const onInputChange = (val: string) => {
    setInput(val);
    if (typingClearRef.current) window.clearTimeout(typingClearRef.current);
    if (val.trim()) {
      if (!typingSentRef.current) {
        typingSentRef.current = true;
        apiPost('/group/typing', { sender_id: senderId, typing: true }).catch(() => {});
      }
      typingClearRef.current = window.setTimeout(() => {
        typingSentRef.current = false;
        apiPost('/group/typing', { sender_id: senderId, typing: false }).catch(() => {});
      }, 2500);
    } else if (typingSentRef.current) {
      typingSentRef.current = false;
      apiPost('/group/typing', { sender_id: senderId, typing: false }).catch(() => {});
    }
    // Detect @mention trigger
    const lastAt = val.lastIndexOf('@');
    if (lastAt >= 0 && (lastAt === 0 || val[lastAt - 1] === ' ' || val[lastAt - 1] === '\n')) {
      setShowMentions(true);
      setMentionFilter(val.slice(lastAt + 1));
    } else {
      setShowMentions(false);
    }
  };

  const insertMention = (id: string) => {
    const lastAt = input.lastIndexOf('@');
    const before = input.slice(0, lastAt);
    setInput(before + '@' + id + ' ');
    setShowMentions(false);
    textareaRef.current?.focus();
  };

  /* ── Send ── */
  const send = async () => {
    const text = input.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      // Extract @mentions from text
      const mentionRe = /@(\w+)/g;
      const mentions: string[] = [];
      let m: RegExpExecArray | null;
      while ((m = mentionRe.exec(text)) !== null) {
        if (roster.some(r => r.id === m![1])) mentions.push(m[1]);
      }
      await apiPost('/group/send', {
        sender_id: senderId,
        text,
        mentions: mentions.length ? mentions : undefined,
        message_type: 'chat',
      });
      setInput('');
      if (typingClearRef.current) window.clearTimeout(typingClearRef.current);
      typingSentRef.current = false;
      await apiPost('/group/typing', { sender_id: senderId, typing: false }).catch(() => {});
      setShowMentions(false);
      await pollMessages();
    } catch (e) {
      showToast?.(`发送失败: ${e}`, 'error');
    } finally {
      setSending(false);
    }
  };

  /* ── Typing indicator ── */
  const onInputKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey && !(e as any).isComposing) {
      e.preventDefault();
      send();
    }
    if (e.key === 'Escape') setShowMentions(false);
  };

  /* ── Render ── */
  const typingMembers = Object.keys(typing).filter(id => id !== senderId);

  return (
    <>
      <TopBar
        left={<IconButton onClick={openSidebar}><IconMenu /></IconButton>}
        center={<span className="topbar-title"><IconUsers size={16} style={{ marginRight: 6, verticalAlign: -2 }} />群聊</span>}
        right={<span style={{ width: 42 }} />}
      />

      {/* Roster bar */}
      <div className="group-roster-bar">
        {roster.map(r => (
          <div key={r.id} className="group-roster-chip" title={memberName(r)}>
            <span className="group-roster-dot" style={{ background: online[r.id] ? (r.color || 'var(--good)') : 'var(--dim)' }} />
            <span className="group-roster-name" style={{ color: r.color || 'var(--ink)' }}>{memberName(r)}</span>
          </div>
        ))}
      </div>

      {/* Message flow */}
      <div className="chat-scroll" ref={logRef}>
        {records.length === 0 && (
          <div style={{ textAlign: 'center', color: 'var(--dim)', padding: '40px 20px' }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)', marginBottom: 4 }}>工作群</div>
            <div style={{ fontSize: 13 }}>发送消息给群组</div>
          </div>
        )}
        {records.length > 0 && (
          <div className="chat-day"><div className="chat-day-line" /><span className="chat-day-label">Today</span><div className="chat-day-line" /></div>
        )}
        {records.map(r => {
          const isMe = r.sender_id === senderId;
          const color = senderColor(r.sender_id, roster);
          const member = roster.find(m => m.id === r.sender_id);
          return (
            <div key={r.ts} style={{ margin: '4px 0 14px' }}>
              {!isMe && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: color, flexShrink: 0 }} />
                  <span style={{ fontSize: 11, fontWeight: 700, color, letterSpacing: '0.03em', textTransform: 'uppercase' }}>
                    {memberName(member) || r.sender_id}
                  </span>
                  {r.message_type === 'task' && (
                    <span style={{ fontSize: 10, background: 'var(--accent-tint)', color: 'var(--accent)', padding: '1px 6px', borderRadius: 6, fontWeight: 600 }}>TASK</span>
                  )}
                </div>
              )}
              <div className={isMe ? 'msg-user' : ''} style={isMe ? {} : { paddingLeft: 4 }}>
                <div className={isMe ? 'msg-user-bubble' : ''} style={isMe ? {} : { maxWidth: '84%', fontSize: 15, lineHeight: 1.55, whiteSpace: 'pre-wrap' as const, overflowWrap: 'break-word' as const }}>
                  {r.text}
                </div>
              </div>
              <div className="msg-time" style={isMe ? { textAlign: 'right' as const } : { paddingLeft: 4 }}>
                {fmtTime(r.ts)}
                {r.task_id && <span style={{ marginLeft: 6, color: 'var(--accent)', fontWeight: 600 }}>#{r.task_id}</span>}
              </div>
            </div>
          );
        })}
        {typingMembers.length > 0 && (
          <div style={{ fontSize: 12, color: 'var(--dim)', padding: '2px 4px', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span className="thinking-dot" /><span className="thinking-dot" /><span className="thinking-dot" />
            <span>{typingMembers.map(id => memberName(roster.find(r => r.id === id)) || id).join(', ')} 正在输入…</span>
          </div>
        )}
      </div>

      {/* @mention popup */}
      {showMentions && <MentionPopup roster={roster} filter={mentionFilter} onSelect={insertMention} />}

      {/* Composer */}
      <div className="composer-wrap">
        <div className="composer-box">
          <textarea
            ref={textareaRef}
            className="composer-textarea"
            value={input}
            onChange={e => onInputChange(e.target.value)}
            onKeyDown={onInputKeyDown}
            placeholder="@名字 提及成员…"
            rows={1}
          />
          <button
            className={`composer-send ${sending ? 'disabled' : input.trim() ? 'active' : 'disabled'}`}
            onClick={send}
            disabled={sending || !input.trim()}
            aria-label={sending ? 'Sending' : 'Send'}
          >
            <IconArrowUp size={18} />
          </button>
        </div>
      </div>
    </>
  );
}
