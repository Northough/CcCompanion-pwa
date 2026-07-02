import { useState, useMemo, useRef } from 'react';
import { IconCopy, IconStar, IconCheck, IconThumbUp, IconThumbDown, IconRefresh, IconSpeak, IconImage } from './Icons';
import { MarkdownBody, CodeBlock } from './ChatBlocks';
import { getServerUrl } from './api';
import { useProfile } from './profile';
import { displayText } from './displayText';

interface ChatRecord { ts: string; role: 'user' | 'assistant' | 'command'; text: string; source?: string; attachments?: { filename: string; url: string; size?: number }[]; quoted_ts?: string; quoted_text?: string; }

function fmtTime(ts: string) {
  try { return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); } catch { return ts.slice(11, 16); }
}

// Long-press (500ms) → open the WeChat-style action menu at the press point
function useLongPress(onLongPress: (x: number, y: number) => void, ms = 500) {
  const timer = useRef<number | undefined>(undefined);
  const start = (e: React.PointerEvent) => {
    const { clientX, clientY } = e;
    timer.current = window.setTimeout(() => onLongPress(clientX, clientY), ms);
  };
  const clear = () => { if (timer.current) window.clearTimeout(timer.current); };
  return {
    onPointerDown: start,
    onPointerUp: clear,
    onPointerLeave: clear,
    onPointerCancel: clear,
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
  };
}

function QuotedBlock({ text }: { text: string }) {
  return <div className="msg-quote">{text}</div>;
}

// ── Block parser: splits assistant text into code blocks + markdown ──

interface TextBlock { type: 'text'; text: string; }
interface CodeSegment { type: 'code'; lang: string; code: string; }
type Block = TextBlock | CodeSegment;

// ── Code keyword heuristic for indented blocks ──

const CODE_KW_RE = /\b(const|let|var|function|return|if|else|for|while|import|from|export|default|class|async|await|def|print|self|try|except|throw|new|require|module|console|interface|type|extends|implements|yield|switch|case|break|continue|throw|typeof|instanceof)\b/;

function isCodeLine(line: string): boolean {
  return /^\s{2,}/.test(line) && CODE_KW_RE.test(line);
}

// Takes a plain text segment (no fenced blocks) and splits into text + indented-code blocks
function splitIndentedCode(text: string): Block[] {
  const lines = text.split('\n');
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    // Find a run of 2+ consecutive indented code lines
    if (isCodeLine(lines[i])) {
      let j = i + 1;
      while (j < lines.length && (isCodeLine(lines[j]) || (lines[j].trim() === '' && j + 1 < lines.length && isCodeLine(lines[j + 1])))) {
        j++;
      }
      // Need at least 2 code lines
      if (j - i >= 2) {
        const code = lines.slice(i, j).map(l => l.replace(/^ {2}/, '')).join('\n').trim();
        if (code) blocks.push({ type: 'code', lang: '', code });
        i = j;
        continue;
      }
    }
    // Not code — accumulate as text
    const start = i;
    while (i < lines.length && !isCodeLine(lines[i])) i++;
    const t = lines.slice(start, i).join('\n').trim();
    if (t) blocks.push({ type: 'text', text: t });
  }
  return blocks;
}

function parseBlocks(text: string): Block[] {
  if (!text) return [];
  // Phase 1: extract fenced ``` blocks
  const fenced: Block[] = [];
  const re = /^\s*```(\w*)\n([\s\S]*?)^\s*```/gm;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) {
      const t = text.slice(last, m.index).trim();
      if (t) fenced.push({ type: 'text', text: t });
    }
    fenced.push({ type: 'code', lang: m[1] || '', code: m[2].replace(/\n$/, '') });
    last = m.index + m[0].length;
  }
  if (last < text.length) {
    const t = text.slice(last).trim();
    if (t) fenced.push({ type: 'text', text: t });
  }
  // Phase 2: for each text block, detect indented code runs
  const result: Block[] = [];
  for (const b of fenced) {
    if (b.type === 'code') { result.push(b); continue; }
    result.push(...splitIndentedCode(b.text));
  }
  return result;
}

// ── User Message ──

function UserMessage({ m, onLongPress }: { m: ChatRecord; onLongPress?: (m: ChatRecord, x: number, y: number) => void }) {
  const profile = useProfile();
  const lp = useLongPress((x, y) => onLongPress?.(m, x, y));
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end', margin: '6px 0 18px', alignItems: 'flex-start', gap: 8, minWidth: 0 }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', minWidth: 0, maxWidth: 'calc(100% - 44px)' }}>
        <span className="msg-time" style={{ marginBottom: 4 }}>{fmtTime(m.ts)}</span>
        <div {...lp} style={{ minWidth: 0, maxWidth: '100%', background: 'var(--user-bubble)', borderRadius: '16px 4px 16px 16px', padding: '12px 16px', color: '#fff', fontSize: 15.5, lineHeight: 1.7, display: 'flex', flexDirection: 'column', gap: 10, overflowWrap: 'anywhere', wordBreak: 'break-word', userSelect: 'none' }}>
          {m.quoted_text && <QuotedBlock text={m.quoted_text} />}
          {m.attachments && m.attachments.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {m.attachments.map((a, i) => {
              const isImg = /\.(png|jpg|jpeg|gif|webp|bmp)$/i.test(a.filename);
              const ext = a.filename.split('.').pop()?.toUpperCase().slice(0, 4) || 'FILE';
              const fmtSize = (n?: number) => { if (n == null) return ''; if (n < 1024) return `${n}B`; if (n < 1048576) return `${(n / 1024).toFixed(1)}KB`; return `${(n / 1048576).toFixed(1)}MB`; };
              return (
                <a key={i} href={`${getServerUrl()}${a.url}`} target="_blank" rel="noopener noreferrer"
                  style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'rgba(255,255,255,0.88)', border: '1px solid rgba(255,255,255,0.5)', borderRadius: 14, padding: '8px 12px', textDecoration: 'none', color: 'var(--ink)', maxWidth: '100%', minWidth: 0 }}>
                  <div style={{ width: 32, height: 32, borderRadius: 8, background: isImg ? 'var(--accent)' : 'var(--ink)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 800, fontFamily: 'var(--font-mono)', flexShrink: 0 }}>
                    {isImg ? <IconImage size={14} /> : ext}
                  </div>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%' }}>{a.filename}</div>
                    {a.size != null && <div style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>{fmtSize(a.size)}</div>}
                  </div>
                </a>
              );
            })}
          </div>
        )}
          {m.text && <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', wordBreak: 'break-word' }}>{displayText(m.text)}</div>}
        </div>
      </div>
      <AvatarBubble name={profile.userName} avatar={profile.userAvatar} size={34} bg="var(--accent)" fg="#fff" />
    </div>
  );
}

// ── Shared avatar component ──

function AvatarBubble({ name, avatar, size = 24, bg = 'var(--surface-2)', fg = 'var(--accent)' }: { name: string; avatar?: string; size?: number; bg?: string; fg?: string }) {
  const initial = name.charAt(0).toUpperCase();
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%', background: avatar ? 'transparent' : bg,
      border: avatar ? '1px solid var(--line)' : 'none',
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      flexShrink: 0, overflow: 'hidden', position: 'relative'
    }}>
      {avatar
        ? <img src={avatar} alt={name} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }} />
        : <span style={{ fontSize: size * 0.44, fontWeight: 800, color: fg, lineHeight: 1 }}>{initial}</span>
      }
    </div>
  );
}

// ── Message Actions ──

function MessageActions({ liked, setLiked, favorite, setFavorite, copied, onCopy, onSpeak, onRegen }: {
  liked: number; setLiked: (f: (n: number) => number) => void;
  favorite: boolean; setFavorite: (f: (b: boolean) => boolean) => void;
  copied: boolean; onCopy: () => void; onSpeak: () => void; onRegen: () => void;
}) {
  const actions = [
    { key: 'copy', icon: copied ? <IconCheck size={16} /> : <IconCopy size={16} />, label: copied ? 'Copied' : 'Copy', onClick: onCopy, active: false },
    { key: 'fav', icon: <IconStar size={16} />, label: 'Save', onClick: () => setFavorite(f => !f), active: favorite },
    { key: 'speak', icon: <IconSpeak size={16} />, label: 'Read', onClick: onSpeak, active: false },
    { key: 'up', icon: <IconThumbUp size={16} />, label: 'Good', onClick: () => setLiked(l => l === 1 ? 0 : 1), active: liked === 1 },
    { key: 'down', icon: <IconThumbDown size={16} />, label: 'Bad', onClick: () => setLiked(l => l === -1 ? 0 : -1), active: liked === -1 },
    { key: 'regen', icon: <IconRefresh size={16} />, label: 'Retry', onClick: onRegen, active: false },
  ];
  return (
    <div style={{ display: 'flex', gap: 4, marginTop: 10, flexWrap: 'wrap' }}>
      {actions.map(a => (
        <button key={a.key} onClick={a.onClick} aria-label={a.label} style={{
          display: 'inline-flex', alignItems: 'center', gap: 4, padding: '6px 10px', borderRadius: 999,
          background: a.active ? 'var(--accent-tint)' : 'transparent',
          border: '1px solid ' + (a.active ? 'var(--accent-soft)' : 'transparent'),
          color: a.active ? 'var(--accent)' : 'var(--muted)', fontSize: 12, fontWeight: 500
        }}>{a.icon}</button>
      ))}
    </div>
  );
}

// ── Assistant Message ──

function AssistantMessage({ m, showToast, onLongPress }: { m: ChatRecord; showToast?: (msg: string, tone?: string) => void; onLongPress?: (m: ChatRecord, x: number, y: number) => void }) {
  const profile = useProfile();
  const [liked, setLiked] = useState(0);
  const [copied, setCopied] = useState(false);
  const [favorite, setFavorite] = useState(false);

  const blocks = useMemo(() => parseBlocks(m.text), [m.text]);
  const lp = useLongPress((x, y) => onLongPress?.(m, x, y));

  const copy = () => {
    if (navigator.clipboard) navigator.clipboard.writeText(m.text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', margin: '4px 0 22px' }}>
      <AvatarBubble name={profile.claudeName} avatar={profile.claudeAvatar} size={34} />
      <div style={{ flex: 1, minWidth: 0, marginRight: 40 }}>
        <span className="msg-time" style={{ display: 'block', marginBottom: 4 }}>{fmtTime(m.ts)}</span>
        {m.quoted_text && <QuotedBlock text={m.quoted_text} />}
        {blocks.map((b, i) => {
          if (b.type === 'code') return <CodeBlock key={i} lang={b.lang} code={b.code} />;
          return <div key={i} className="md md-bubble" {...lp}><MarkdownBody text={displayText(b.text)} /></div>;
        })}
        <MessageActions liked={liked} setLiked={setLiked} favorite={favorite} setFavorite={setFavorite} copied={copied} onCopy={copy} onSpeak={() => showToast?.('Speaking...')} onRegen={() => showToast?.('Regenerating...')} />
      </div>
    </div>
  );
}

// ── Command Message ──

function CommandMessage({ m }: { m: ChatRecord }) {
  return (
    <div className="msg-command">
      <div className="msg-command-bubble">{displayText(m.text)}</div>
      <div className="msg-time">{fmtTime(m.ts)}</div>
    </div>
  );
}

// ── Command receipt (完成/取消/超时) — shown as a small left-aligned note, not a user bubble ──

const COMMAND_RECEIPT_RE = /^\s*(✓ 完成了|✕ 取消了|⏱ )/;

function isCommandReceipt(text: string): boolean {
  return COMMAND_RECEIPT_RE.test(text);
}

function CommandNote({ m }: { m: ChatRecord }) {
  return <div className="msg-cmd-note">{displayText(m.text)}</div>;
}

// ── MessageRow (exported) ──

export function MessageRow({ r, showToast, onLongPress, selectMode, selected, onToggleSelect }: {
  r: ChatRecord;
  showToast?: (msg: string, tone?: string) => void;
  onLongPress?: (m: ChatRecord, x: number, y: number) => void;
  selectMode?: boolean;
  selected?: boolean;
  onToggleSelect?: (m: ChatRecord) => void;
}) {
  if (r.role === 'command') return <CommandMessage m={r} />;
  const isReceipt = r.role === 'user' && isCommandReceipt(r.text);
  const inner = isReceipt
    ? <CommandNote m={r} />
    : r.role === 'user'
      ? <UserMessage m={r} onLongPress={selectMode ? undefined : onLongPress} />
      : <AssistantMessage m={r} showToast={showToast} onLongPress={selectMode ? undefined : onLongPress} />;

  // In multi-select mode, wrap selectable messages (user/assistant, not receipts) with a checkbox row
  if (selectMode && !isReceipt) {
    return (
      <div className={`msg-select-row${selected ? ' is-selected' : ''}`} onClick={() => onToggleSelect?.(r)}>
        <span className={`msg-select-check${selected ? ' is-on' : ''}`}>{selected ? '✓' : ''}</span>
        <div style={{ flex: 1, minWidth: 0, pointerEvents: 'none' }}>{inner}</div>
      </div>
    );
  }
  return inner;
}
