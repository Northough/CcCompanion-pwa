import { useState, useMemo } from 'react';
import { IconCopy, IconChevDown, IconBolt, IconLock, IconTool } from './Icons';

// ── Markdown ──

export function MarkdownBody({ text }: { text: string }) {
  const html = useMemo(() => renderMarkdown(text || ''), [text]);
  return <div className="md" dangerouslySetInnerHTML={{ __html: html }} />;
}

function renderMarkdown(src: string): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const inline = (s: string) => esc(s)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*]+)\*([^*]|$)/g, '$1<em>$2</em>$3')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  const lines = src.split('\n');
  let out = '';
  let inUl = false, inOl = false;
  const closeLists = () => { if (inUl) { out += '</ul>'; inUl = false; } if (inOl) { out += '</ol>'; inOl = false; } };
  for (const ln of lines) {
    const ulm = ln.match(/^\s*[-*]\s+(.*)$/);
    const olm = ln.match(/^\s*(\d+)\.\s+(.*)$/);
    const hm = ln.match(/^(#{1,3})\s+(.*)$/);
    if (hm) { closeLists(); out += `<h${hm[1].length}>${inline(hm[2])}</h${hm[1].length}>`; continue; }
    if (ulm) { if (!inUl) { closeLists(); out += '<ul>'; inUl = true; } out += `<li>${inline(ulm[1])}</li>`; continue; }
    if (olm) { if (!inOl) { closeLists(); out += '<ol>'; inOl = true; } out += `<li>${inline(olm[2])}</li>`; continue; }
    if (ln.trim() === '') { closeLists(); continue; }
    closeLists();
    out += `<p>${inline(ln)}</p>`;
  }
  closeLists();
  return out;
}

// ── Code Block ──

export function CodeBlock({ lang, filename, code }: { lang?: string; filename?: string; code: string }) {
  const highlighted = useMemo(() => highlight(code, lang), [code, lang]);
  return (
    <div style={{ margin: '4px 0 14px' }}>
      <div className="codeblock-head">
        <span>{filename || lang || 'code'}</span>
        <button onClick={() => navigator.clipboard?.writeText(code)} style={{ background: 'transparent', border: 'none', color: '#BFB6A9', display: 'inline-flex', alignItems: 'center', gap: 4, fontFamily: 'inherit', fontSize: 'inherit', cursor: 'pointer' }}>
          <IconCopy size={13} /> copy
        </button>
      </div>
      <pre className="codeblock" style={{ margin: 0 }}><code dangerouslySetInnerHTML={{ __html: highlighted }} /></pre>
    </div>
  );
}

function highlight(code: string, _lang?: string): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  let out = esc(code);
  out = out.replace(/(\/\/.*?)(?=\n|$)/g, '<span class="com">$1</span>');
  out = out.replace(/(['"`])(.*?)\1/g, '<span class="str">$1$2$1</span>');
  out = out.replace(/\b(const|let|var|function|return|if|else|new|async|await|import|from|export|class|sort)\b/g, '<span class="kw">$1</span>');
  out = out.replace(/\b(\d+)\b/g, '<span class="num">$1</span>');
  return out;
}

// ── Tool Call ──

export function ToolCall({ name, args, status, durationMs, preview }: { name: string; args?: Record<string, unknown>; status?: string; durationMs?: number; preview?: string }) {
  const argStr = useMemo(() => {
    if (!args) return '';
    return Object.entries(args).map(([k, v]) => `${k}=${typeof v === 'string' ? `"${v}"` : JSON.stringify(v)}`).join(' ');
  }, [args]);
  const [expanded, setExpanded] = useState(false);
  const running = status === 'running';
  return (
    <div style={{ margin: '4px 0 14px', background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 14, overflow: 'hidden' }}>
      <button onClick={() => setExpanded(e => !e)} style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '11px 14px', background: 'transparent', border: 'none', color: 'var(--ink)', textAlign: 'left' }}>
        <span style={{ width: 22, height: 22, borderRadius: 6, background: running ? 'var(--accent-tint)' : 'var(--bg-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: running ? 'var(--accent)' : 'var(--ink-2)' }}>
          {running ? <span style={{ width: 10, height: 10, borderRadius: '50%', border: '2px solid currentColor', borderTopColor: 'transparent', animation: 'spin 0.8s linear infinite', display: 'inline-block' }} /> : <IconTool size={13} />}
        </span>
        <span className="mono" style={{ fontSize: 13, fontWeight: 600 }}>{name}</span>
        <span className="mono" style={{ fontSize: 12, color: 'var(--muted)', flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{argStr}</span>
        {running ? <span style={{ fontSize: 11, color: 'var(--accent)', fontWeight: 600 }}>running...</span> : <span className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}>{durationMs}ms</span>}
        <IconChevDown size={14} style={{ color: 'var(--dim)', transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.18s' }} />
      </button>
      {expanded && preview && (
        <div className="mono" style={{ padding: '8px 14px 12px', fontSize: 12, color: 'var(--ink-2)', borderTop: '1px solid var(--line)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{preview}</div>
      )}
    </div>
  );
}

// ── Thinking Block ──

export function ThinkingBlock({ summary, text }: { summary?: string; text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ margin: '4px 0 14px', background: 'var(--accent-tint)', borderRadius: 14, border: '1px dashed var(--accent-soft)' }}>
      <button onClick={() => setOpen(o => !o)} style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '10px 14px', background: 'transparent', border: 'none', color: 'var(--accent)', textAlign: 'left' }}>
        <IconBolt size={15} />
        <span style={{ fontSize: 13, fontWeight: 600 }}>{summary || 'Thinking'}</span>
        <span style={{ flex: 1 }} />
        <IconChevDown size={14} style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.18s' }} />
      </button>
      {open && <div style={{ padding: '0 14px 12px', fontSize: 13.5, lineHeight: 1.55, color: 'var(--ink-2)', fontStyle: 'italic' }}>{text}</div>}
    </div>
  );
}

// ── Permission Request ──

export function PermissionRequest({ tool, args, description, onApprove, onDeny }: { tool: string; args?: Record<string, unknown>; description?: string; onApprove: () => void; onDeny: () => void }) {
  return (
    <div style={{ margin: '4px 0 14px', background: '#FFF7E8', border: '1px solid #E8C97A', borderRadius: 16, padding: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{ width: 24, height: 24, borderRadius: '50%', background: 'var(--warn)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><IconLock size={13} /></span>
        <span style={{ fontSize: 13, fontWeight: 700, color: '#7a5510' }}>Permission required</span>
      </div>
      <div className="mono" style={{ fontSize: 12, color: 'var(--ink-2)', background: 'rgba(255,255,255,0.6)', padding: '8px 10px', borderRadius: 8, marginBottom: 8, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
        {tool}({Object.entries(args || {}).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(', ')})
      </div>
      {description && <div style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.5, marginBottom: 12 }}>{description}</div>}
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={onDeny} style={{ flex: 1, padding: '10px 0', borderRadius: 999, background: 'transparent', border: '1px solid #E8C97A', color: '#7a5510', fontSize: 13.5, fontWeight: 600 }}>Deny</button>
        <button onClick={onApprove} style={{ flex: 1.4, padding: '10px 0', borderRadius: 999, background: 'var(--ink)', border: 'none', color: 'var(--bg)', fontSize: 13.5, fontWeight: 700 }}>Allow once</button>
        <button onClick={onApprove} style={{ flex: 1.2, padding: '10px 0', borderRadius: 999, background: 'transparent', border: '1px solid var(--ink)', color: 'var(--ink)', fontSize: 13.5, fontWeight: 600 }}>Always</button>
      </div>
    </div>
  );
}

// ── Attachment Chip (for composer preview) ──

export function AttachmentChip({ filename, size, onRemove, small }: { filename: string; size?: number; onRemove?: () => void; small?: boolean }) {
  const ext = (filename.split('.').pop() || '').toUpperCase().slice(0, 4);
  const isImg = /\.(png|jpg|jpeg|gif|webp|bmp)$/i.test(filename);
  const fmtSize = (n?: number) => { if (n == null) return ''; if (n < 1024) return `${n}B`; if (n < 1048576) return `${(n / 1024).toFixed(1)}KB`; return `${(n / 1048576).toFixed(1)}MB`; };
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10, background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 12, padding: small ? '6px 10px 6px 6px' : '8px 12px 8px 8px', maxWidth: '100%' }}>
      <div style={{ width: small ? 28 : 36, height: small ? 28 : 36, borderRadius: 8, background: isImg ? 'var(--accent-soft)' : 'var(--ink)', color: isImg ? 'var(--accent)' : 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 800, fontFamily: 'var(--font-mono)', flexShrink: 0 }}>
        {isImg ? <IconImage16 /> : ext}
      </div>
      <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 200 }}>{filename}</div>
        {size != null && <div style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>{fmtSize(size)}</div>}
      </div>
      {onRemove && (
        <button onClick={onRemove} style={{ width: 22, height: 22, borderRadius: '50%', background: 'var(--bg-2)', border: 'none', color: 'var(--ink-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 14, lineHeight: 1 }}>x</button>
      )}
    </div>
  );
}

function IconImage16() {
  return <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.6"/><polyline points="3 17 9 12 13 16 17 12 21 16"/></svg>;
}
