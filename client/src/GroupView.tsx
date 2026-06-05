import { useState, useRef, useEffect, useCallback } from 'react';
import { apiGet, apiPost } from './api';
import { IconMenu, IconArrowUp, IconUsers, IconEdit, IconCheck } from './Icons';
import { TopBar, IconButton } from './Shell';
import { getProfile, saveProfile, notifyProfileChanged } from './profile';

/* ── Types ── */

interface RosterMember { id: string; name?: string; display_name?: string; color?: string; model?: string; kind?: string; bridge?: string; default_responder?: boolean }
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

const GROUP_SELF_COLOR_KEY = 'cc_group_self_color';
const GROUP_SWATCHES = ['#D94683', '#E779A8', '#8B6FD1', '#4C9A78', '#D98B2B', '#D94A62'];
const LEGACY_GROUP_COLORS: Record<string, string> = {
  '#B85C2E': '#D94683',
  '#4F7B4A': '#E779A8',
  '#3A6FA0': '#8B6FD1',
  '#8B5CF6': '#4C9A78',
  '#2F7D6B': '#4C9A78',
  '#B7791F': '#D98B2B',
  '#5466A3': '#8B6FD1',
  '#B75353': '#D94A62',
};

function normalizeGroupColor(color?: string, fallback = '#888888'): string {
  const raw = (color || '').trim();
  return LEGACY_GROUP_COLORS[raw.toUpperCase()] || raw || fallback;
}

function senderColor(id: string, roster: RosterMember[]): string {
  const m = roster.find(r => r.id === id);
  return normalizeGroupColor(m?.color, '#888888');
}

function memberName(member?: RosterMember): string {
  return member?.name || member?.display_name || member?.id || 'Unknown';
}

function mentionHandle(member: RosterMember): string {
  return memberName(member).replace(/^@+/, '').trim().replace(/\s+/g, '_') || member.id;
}

function mentionAliases(member: RosterMember): string[] {
  const values = [member.id, member.name, member.display_name, mentionHandle(member)]
    .filter((v): v is string => Boolean(v && v.trim()))
    .map(v => v.replace(/^@+/, '').trim().toLowerCase());
  return Array.from(new Set(values));
}

function extractMentionIds(text: string, roster: RosterMember[]): string[] {
  const aliases = new Map<string, string>();
  roster.forEach(member => mentionAliases(member).forEach(alias => aliases.set(alias, member.id)));
  const mentions: string[] = [];
  const mentionRe = /@([^\s@，,。:：;；)）\]}]+)/gu;
  let m: RegExpExecArray | null;
  while ((m = mentionRe.exec(text)) !== null) {
    const key = m[1].replace(/[.!?！？、]+$/g, '').toLowerCase();
    const id = aliases.get(key);
    if (id && !mentions.includes(id)) mentions.push(id);
  }
  return mentions;
}

function memberHint(member: RosterMember): string {
  if (member.default_responder) return 'default';
  return member.kind || member.bridge || member.model || 'member';
}

/* ── @Mention autocomplete ── */

function MentionPopup({ roster, filter, onSelect }: { roster: RosterMember[]; filter: string; onSelect: (id: string) => void }) {
  const filtered = roster.filter(r => r.id !== 'user' && (
    !filter || mentionAliases(r).some(alias => alias.includes(filter.toLowerCase()))
  ));
  if (filtered.length === 0) return null;
  return (
    <div className="cmd-popup" style={{ margin: '0 14px 4px' }}>
      {filtered.map(r => (
        <button key={r.id} className="cmd-item" onClick={() => onSelect(mentionHandle(r))}>
          <span className="cmd-icon" style={{ background: r.color || '#888', color: '#fff', fontSize: 11 }}>{memberName(r)[0]}</span>
          <span className="cmd-name">@{mentionHandle(r)}</span>
          <span className="cmd-desc">{memberHint(r)}</span>
        </button>
      ))}
    </div>
  );
}

/* ── Main Component ── */

export default function GroupView({ openSidebar, showToast }: { openSidebar: () => void; showToast?: (m: string, t?: string) => void }) {
  const senderId = 'user';  // Stable protocol id for this PWA client
  const [records, setRecords] = useState<GroupRecord[]>([]);
  const [roster, setRoster] = useState<RosterMember[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [lastTs, setLastTs] = useState<string | null>(null);
  const [online, setOnline] = useState<Record<string, string>>({});
  const [typing, setTyping] = useState<Record<string, string>>({});
  const [identityOpen, setIdentityOpen] = useState(false);
  const [selectedMemberId, setSelectedMemberId] = useState(senderId);
  const [selfName, setSelfName] = useState(() => getProfile().userName || 'Me');
  const [selfColor, setSelfColor] = useState(() => normalizeGroupColor(localStorage.getItem(GROUP_SELF_COLOR_KEY) || '#D94683', '#D94683'));
  const [draftName, setDraftName] = useState(() => getProfile().userName || 'Me');
  const [draftColor, setDraftColor] = useState(() => normalizeGroupColor(localStorage.getItem(GROUP_SELF_COLOR_KEY) || '#D94683', '#D94683'));

  // @mention state
  const [showMentions, setShowMentions] = useState(false);
  const [mentionFilter, setMentionFilter] = useState('');

  const logRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const typingSentRef = useRef(false);
  const typingClearRef = useRef<number | null>(null);
  const displayRoster = roster.map(r => {
    let member = { ...r, color: normalizeGroupColor(r.color) };
    if (r.id === senderId) {
      member = { ...member, name: selfName || r.name, display_name: selfName || r.display_name, color: selfColor || member.color };
    }
    if (identityOpen && r.id === selectedMemberId) {
      member = { ...member, name: draftName || memberName(member), display_name: draftName || memberName(member), color: draftColor || member.color };
    }
    return member;
  });
  const selectedMember = displayRoster.find(r => r.id === selectedMemberId) || displayRoster.find(r => r.id === senderId);

  /* ── Poll roster ── */
  const pollRoster = useCallback(async () => {
    try {
      const d = await apiGet('/group/roster');
      if (d.ok) {
        const nextRoster = d.roster || [];
        setRoster(nextRoster);
        const self = nextRoster.find((r: RosterMember) => r.id === senderId);
        if (!localStorage.getItem(GROUP_SELF_COLOR_KEY) && self?.color) setSelfColor(self.color);
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

  const openIdentityFor = (member: RosterMember) => {
    setSelectedMemberId(member.id);
    setDraftName(memberName(member));
    setDraftColor(member.color || '#888888');
    setIdentityOpen(true);
  };

  const toggleIdentity = () => {
    const member = displayRoster.find(r => r.id === selectedMemberId) || displayRoster.find(r => r.id === senderId);
    if (member) {
      setDraftName(memberName(member));
      setDraftColor(member.color || '#888888');
    }
    setIdentityOpen(v => !v);
  };

  const saveIdentity = async () => {
    const memberId = selectedMemberId || senderId;
    const name = draftName.trim() || memberName(selectedMember) || memberId;
    const color = draftColor || selectedMember?.color || '#888888';
    if (memberId === senderId) {
      setSelfName(name);
      setSelfColor(color);
      localStorage.setItem(GROUP_SELF_COLOR_KEY, color);
      const profile = getProfile();
      saveProfile({ ...profile, userName: name });
      notifyProfileChanged();
    }
    try {
      await apiPost('/group/member/update', {
        member_id: memberId,
        name,
        display_name: name,
        color,
      });
      await pollRoster();
      setIdentityOpen(false);
      showToast?.('成员已更新', 'success');
    } catch (e) {
      showToast?.(`保存失败: ${e}`, 'error');
    }
  };

  /* ── Send ── */
  const send = async () => {
    const text = input.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      const mentions = extractMentionIds(text, displayRoster);
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
        center={<span className="topbar-title"><IconUsers size={16} style={{ marginRight: 6, verticalAlign: -2 }} />Group</span>}
        right={<IconButton onClick={toggleIdentity} label="Identity" active={identityOpen}><IconEdit size={18} /></IconButton>}
      />

      {/* Roster bar */}
      <div className="group-roster-bar">
        {displayRoster.map(r => (
          <button key={r.id} className={`group-roster-chip${identityOpen && r.id === selectedMemberId ? ' active' : ''}`} title={memberName(r)} onClick={() => openIdentityFor(r)}>
            <span className="group-roster-dot" style={{ background: online[r.id] ? (r.color || 'var(--good)') : 'var(--dim)' }} />
            <span className="group-roster-name" style={{ color: r.color || 'var(--ink)' }}>{memberName(r)}</span>
          </button>
        ))}
      </div>

      {identityOpen && (
        <div className="group-identity-panel">
          <div className="group-identity-row">
            <span className="group-identity-label">@{selectedMember ? mentionHandle(selectedMember) : selectedMemberId}</span>
            <input className="group-identity-input" value={draftName} onChange={e => setDraftName(e.target.value)} maxLength={32} placeholder={memberName(selectedMember)} />
          </div>
          <div className="group-color-row">
            {GROUP_SWATCHES.map(color => (
              <button
                key={color}
                className={`group-color-swatch${draftColor === color ? ' active' : ''}`}
                style={{ background: color }}
                onClick={() => setDraftColor(color)}
                aria-label={color}
              />
            ))}
            <button className="group-save-btn" onClick={saveIdentity}><IconCheck size={15} />Save</button>
          </div>
        </div>
      )}

      {/* Message flow */}
      <div className="chat-scroll" ref={logRef}>
        {records.length === 0 && (
          <div style={{ textAlign: 'center', color: 'var(--dim)', padding: '40px 20px' }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)', marginBottom: 4 }}>Group</div>
            <div style={{ fontSize: 13 }}>发送消息给成员</div>
          </div>
        )}
        {records.length > 0 && (
          <div className="chat-day"><div className="chat-day-line" /><span className="chat-day-label">Today</span><div className="chat-day-line" /></div>
        )}
        {records.map(r => {
          const isMe = r.sender_id === senderId;
          const color = senderColor(r.sender_id, displayRoster);
          const member = displayRoster.find(m => m.id === r.sender_id);
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
            <span>{typingMembers.map(id => memberName(displayRoster.find(r => r.id === id)) || id).join(', ')} 正在输入…</span>
          </div>
        )}
      </div>

      {/* @mention popup */}
      {showMentions && <MentionPopup roster={displayRoster} filter={mentionFilter} onSelect={insertMention} />}

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
