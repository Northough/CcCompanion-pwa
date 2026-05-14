import { useState, useEffect, useRef, useMemo } from 'react';
import { apiGet, apiPost } from './api';
import { IconMenu, IconPlus, IconClose, IconSearch, IconBrain, IconChevDown, IconClock, IconTrash, IconInbox, IconReindex, IconDatabase, IconDot } from './Icons';
import { TopBar, IconButton } from './Shell';

const TYPES = ['preference', 'project', 'relation', 'state', 'instruction'];
function typeZh(t: string) { const m: Record<string, string> = { all: '全部', preference: '偏好', project: '项目', relation: '关系', state: '状态', instruction: '指令' }; return m[t] || t; }

function fmtTime(iso: string) {
  try { return new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch { return iso; }
}

function TypeTag({ type }: { type: string }) {
  const p: Record<string, { bg: string; fg: string; label: string }> = {
    preference: { bg: 'rgba(184,92,46,0.10)', fg: 'var(--accent)', label: '偏好' },
    project: { bg: 'rgba(92,122,168,0.10)', fg: '#3B5980', label: '项目' },
    relation: { bg: 'rgba(126,154,92,0.10)', fg: '#5A7440', label: '关系' },
    state: { bg: 'rgba(176,122,30,0.10)', fg: '#8A5E14', label: '状态' },
    instruction: { bg: 'rgba(27,24,20,0.06)', fg: 'var(--ink-2)', label: '指令' },
  };
  const c = p[type] || p.instruction;
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: c.bg, color: c.fg, padding: '3px 9px', borderRadius: 999, fontSize: 11, fontWeight: 700, letterSpacing: '0.02em' }}>{c.label}</span>;
}

function StatusPill({ label, value, good, mono }: { label: string; value: string; good?: boolean; mono?: boolean }) {
  return (
    <div style={{ flex: 1, background: 'var(--bg-2)', borderRadius: 12, padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 2 }}>
      <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 13, color: good != null ? (good ? 'var(--good)' : 'var(--muted)') : 'var(--ink)', fontWeight: 600, fontFamily: mono ? 'var(--font-mono)' : 'inherit' }}>{value}</div>
    </div>
  );
}

function ActionPill({ icon, children, onClick, loading, badge }: { icon: React.ReactNode; children: React.ReactNode; onClick: () => void; loading?: boolean; badge?: number }) {
  return (
    <button onClick={onClick} disabled={loading} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 999, background: 'var(--surface-2)', border: '1px solid var(--line)', color: 'var(--ink)', fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', flexShrink: 0, position: 'relative' }}>
      {loading ? <span style={{ width: 12, height: 12, borderRadius: '50%', border: '2px solid var(--accent)', borderTopColor: 'transparent', animation: 'spin 0.8s linear infinite' }} /> : <span style={{ color: 'var(--accent)' }}>{icon}</span>}
      {children}
      {badge ? <span style={{ marginLeft: 4, background: 'var(--accent)', color: '#fff', fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 999 }}>{badge}</span> : null}
    </button>
  );
}

function SmallAction({ icon, label, onClick, danger }: { icon: React.ReactNode; label: string; onClick: () => void; danger?: boolean }) {
  return <button onClick={onClick} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 10px', borderRadius: 999, background: 'transparent', border: 'none', color: danger ? 'var(--bad)' : 'var(--muted)', fontSize: 12, fontWeight: 600 }}>{icon}<span>{label}</span></button>;
}

function MemoryCard({ m, onExpire, onDelete }: { m: any; onExpire: () => void; onDelete: () => void }) {
  const [open, setOpen] = useState(false);
  const expired = m.status === 'expired';
  return (
    <div style={{ background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 18, padding: 14, opacity: expired ? 0.55 : 1 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <TypeTag type={m.type} />
        {expired && <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', padding: '2px 6px', borderRadius: 999, background: 'var(--bg-2)' }}>EXPIRED</span>}
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: 'var(--dim)', fontFamily: 'var(--font-mono)' }}>{fmtTime(m.updated_at)}</span>
      </div>
      <div style={{ fontSize: 14.5, color: 'var(--ink)', lineHeight: 1.55, marginBottom: 8 }}>{m.content}</div>
      {open && m.evidence && (
        <div style={{ background: 'var(--bg-2)', borderRadius: 10, padding: 10, marginBottom: 10 }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--muted)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 4 }}>Evidence</div>
          <div style={{ fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.5 }}>{m.evidence}</div>
          {m.confidence != null && <div style={{ fontSize: 11, color: 'var(--dim)', marginTop: 6, fontFamily: 'var(--font-mono)' }}>confidence {m.confidence.toFixed(2)}</div>}
        </div>
      )}
      <div style={{ display: 'flex', gap: 4, marginLeft: -6 }}>
        <SmallAction icon={<IconChevDown size={14} style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.18s' }} />} label={open ? 'Hide' : 'Evidence'} onClick={() => setOpen(o => !o)} />
        {!expired && <SmallAction icon={<IconClock size={14} />} label="Expire" onClick={onExpire} />}
        <SmallAction icon={<IconTrash size={14} />} label="Delete" danger onClick={onDelete} />
      </div>
    </div>
  );
}

function PendingSheet({ open, onClose, items, onAccept, onReject }: { open: boolean; onClose: () => void; items: any[]; onAccept: (id: string) => void; onReject: (id: string) => void }) {
  if (!open) return null;
  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 60, background: 'rgba(20,16,12,0.36)', display: 'flex', alignItems: 'flex-end' }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxHeight: '88%', background: 'var(--bg)', borderRadius: '24px 24px 0 0', boxShadow: '0 -20px 60px rgba(0,0,0,0.3)', display: 'flex', flexDirection: 'column', overflow: 'hidden', animation: 'sheetIn 0.26s cubic-bezier(0.2,0.8,0.2,1)' }}>
        <div style={{ display: 'flex', justifyContent: 'center', padding: '10px 0 4px' }}><div style={{ width: 40, height: 4, borderRadius: 2, background: 'var(--line-2)' }} /></div>
        <div style={{ padding: '8px 22px 6px' }}>
          <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>待确认记忆</h3>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>Claude 推测出来的事实，要不要记下来？</div>
        </div>
        <div className="scroll" style={{ padding: '14px 16px 28px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {items.length === 0 && <div style={{ textAlign: 'center', color: 'var(--muted)', padding: 24 }}>没有待确认项</div>}
          {items.map(p => (
            <div key={p.id} style={{ background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 16, padding: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <TypeTag type={p.type} />
                {p.confidence != null && <span style={{ fontSize: 11, color: 'var(--dim)', fontFamily: 'var(--font-mono)' }}>confidence {p.confidence.toFixed(2)}</span>}
              </div>
              <div style={{ fontSize: 14, color: 'var(--ink)', lineHeight: 1.5, marginBottom: 12 }}>{p.content}</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => onReject(p.id)} style={{ flex: 1, padding: '10px 0', borderRadius: 999, background: 'transparent', border: '1px solid var(--line)', color: 'var(--muted)', fontSize: 13, fontWeight: 600 }}>忽略</button>
                <button onClick={() => onAccept(p.id)} style={{ flex: 1.4, padding: '10px 0', borderRadius: 999, background: 'var(--ink)', border: 'none', color: 'var(--bg)', fontSize: 13, fontWeight: 700 }}>保存</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function CreateSheet({ open, onClose, onCreate }: { open: boolean; onClose: () => void; onCreate: (m: any) => void }) {
  const [type, setType] = useState('preference');
  const [content, setContent] = useState('');
  if (!open) return null;
  const submit = async () => {
    if (!content.trim()) return;
    try { const d = await apiPost('/memory/create', { type, content: content.trim(), evidence: '手动添加', confidence: 1 }); if (d.ok) { onCreate(d.memory); onClose(); setContent(''); } } catch (e) { alert(`创建失败: ${e}`); }
  };
  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 60, background: 'rgba(20,16,12,0.36)', display: 'flex', alignItems: 'flex-end' }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxHeight: '88%', background: 'var(--bg)', borderRadius: '24px 24px 0 0', boxShadow: '0 -20px 60px rgba(0,0,0,0.3)', display: 'flex', flexDirection: 'column', overflow: 'hidden', animation: 'sheetIn 0.26s cubic-bezier(0.2,0.8,0.2,1)' }}>
        <div style={{ display: 'flex', justifyContent: 'center', padding: '10px 0 4px' }}><div style={{ width: 40, height: 4, borderRadius: 2, background: 'var(--line-2)' }} /></div>
        <div style={{ padding: '8px 22px 6px' }}><h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>新增记忆</h3></div>
        <div style={{ padding: '14px 22px 6px' }}>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>类型</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {TYPES.map(t => <button key={t} onClick={() => setType(t)} style={{ padding: '8px 14px', borderRadius: 999, fontSize: 12.5, fontWeight: 600, background: type === t ? 'var(--ink)' : 'transparent', color: type === t ? 'var(--bg)' : 'var(--muted)', border: '1px solid ' + (type === t ? 'var(--ink)' : 'var(--line)') }}>{typeZh(t)}</button>)}
          </div>
        </div>
        <div style={{ padding: '14px 22px 14px' }}>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>内容</div>
          <textarea value={content} onChange={e => setContent(e.target.value)} rows={4} placeholder="例如：默认偏好使用 opus 模型。" style={{ width: '100%', resize: 'none', padding: 12, border: '1px solid var(--line)', borderRadius: 14, background: 'var(--surface-2)', fontFamily: 'inherit', fontSize: 14, color: 'var(--ink)', outline: 'none', boxSizing: 'border-box' }} />
        </div>
        <div style={{ padding: '4px 16px 28px', display: 'flex', gap: 10 }}>
          <button onClick={onClose} style={{ flex: 1, padding: '14px 0', borderRadius: 999, background: 'var(--surface-2)', border: '1px solid var(--line)', color: 'var(--ink)', fontSize: 14, fontWeight: 600 }}>取消</button>
          <button onClick={submit} style={{ flex: 1.4, padding: '14px 0', borderRadius: 999, background: 'var(--ink)', border: 'none', color: 'var(--bg)', fontSize: 14, fontWeight: 700 }}>保存</button>
        </div>
      </div>
    </div>
  );
}

export default function MemoryView({ openSidebar, showToast }: { openSidebar: () => void; showToast: (m: string, t?: string) => void }) {
  const [status, setStatus] = useState<any>(null);
  const [items, setItems] = useState<any[]>([]);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<any[]>([]);
  const [showPending, setShowPending] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [reindexing, setReindexing] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadAll = async () => {
    try {
      const [s, l, p] = await Promise.all([apiGet('/memory/status'), apiGet('/memory/list'), apiGet('/memory/pending')]);
      if (s.ok) setStatus(s);
      if (l.ok) setItems(l.memories);
      if (p.ok) setPending(p.pending);
    } catch {} finally { setLoading(false); }
  };

  useEffect(() => { loadAll(); }, []);

  const runSearch = (q: string) => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(async () => {
      try {
        const d = await apiGet(`/memory/search?q=${encodeURIComponent(q)}`);
        if (d.ok) setItems(d.memories);
      } catch {}
    }, 220);
  };

  useEffect(() => { if (query) runSearch(query); else loadAll(); }, [query]);

  const reindex = async () => {
    setReindexing(true);
    try { const d = await apiPost('/memory/reindex', {}); showToast(`Reindexed ${d.indexed} items`, 'success'); } catch (e) { showToast(`失败: ${e}`, 'error'); }
    setReindexing(false);
  };

  const filtered = useMemo(() => filter === 'all' ? items : items.filter(i => i.type === filter), [items, filter]);

  return (
    <>
      <TopBar left={<IconButton onClick={openSidebar}><IconMenu /></IconButton>} center={<span className="topbar-title">Memory</span>} right={<IconButton onClick={() => setShowCreate(true)}><IconPlus /></IconButton>} />
      <div className="scroll" style={{ flex: 1, padding: '4px 18px 28px' }}>
        {/* Status card */}
        {loading ? <div style={{ height: 96, background: 'var(--surface-2)', borderRadius: 22, border: '1px solid var(--line)' }} /> : (
          <div style={{ background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 22, padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ width: 40, height: 40, borderRadius: 12, background: 'var(--accent-tint)', color: 'var(--accent)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}><IconDatabase size={22} /></span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 15.5, fontWeight: 700, color: 'var(--ink)' }}>本地记忆</div>
                <div style={{ fontSize: 12.5, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <IconDot size={6} color={status?.ok ? 'var(--good)' : 'var(--bad)'} />
                  {status?.ok ? '已连接' : '未连接'}
                  <span style={{ color: 'var(--dim)' }}>·</span>
                  <span style={{ fontFamily: 'var(--font-mono)' }}>{status?.count ?? 0} items</span>
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <StatusPill label="记忆注入" value={status?.injection_enabled ? '开启' : '关闭'} good={status?.injection_enabled} />
              <StatusPill label="Top K" value={String(status?.top_k ?? 8)} mono />
            </div>
          </div>
        )}

        {/* Search */}
        <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 10, background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 999, padding: '10px 14px' }}>
          <IconSearch size={18} style={{ color: 'var(--muted)' }} />
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder='搜索记忆…' style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', fontFamily: 'inherit', fontSize: 14, color: 'var(--ink)' }} />
          {query && <button onClick={() => setQuery('')} style={{ background: 'transparent', border: 'none', color: 'var(--muted)', padding: 0, lineHeight: 0 }}><IconClose size={16} /></button>}
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: 8, overflowX: 'auto', padding: '14px 0 6px', margin: '0 -2px' }}>
          <ActionPill icon={<IconPlus size={14} />} onClick={() => setShowCreate(true)}>新增</ActionPill>
          <ActionPill icon={<IconReindex size={14} />} onClick={reindex} loading={reindexing}>重建索引</ActionPill>
          <ActionPill icon={<IconInbox size={14} />} onClick={() => setShowPending(true)} badge={pending.length}>待确认</ActionPill>
        </div>

        {/* Type filter */}
        <div style={{ display: 'flex', gap: 6, overflowX: 'auto', padding: '8px 0 4px', margin: '0 -2px' }}>
          {['all', ...TYPES].map(t => <button key={t} onClick={() => setFilter(t)} style={{ padding: '6px 12px', borderRadius: 999, fontSize: 12, fontWeight: 600, background: filter === t ? 'var(--ink)' : 'transparent', color: filter === t ? 'var(--bg)' : 'var(--muted)', border: '1px solid ' + (filter === t ? 'var(--ink)' : 'var(--line)'), whiteSpace: 'nowrap', flexShrink: 0 }}>{typeZh(t)}</button>)}
        </div>

        {/* List */}
        <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {loading && [0, 1, 2].map(i => <div key={i} style={{ height: 110, background: 'var(--surface-2)', borderRadius: 18, border: '1px solid var(--line)', opacity: 0.5 }} />)}
          {!loading && filtered.length === 0 && (
            <div style={{ padding: '36px 12px', textAlign: 'center', color: 'var(--muted)' }}>
              <div style={{ width: 48, height: 48, borderRadius: '50%', background: 'var(--bg-2)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 10, color: 'var(--ink-2)' }}><IconBrain size={22} /></div>
              <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)' }}>No memories yet</div>
              <div style={{ fontSize: 13, marginTop: 4 }}>保存偏好、项目和上下文信息</div>
            </div>
          )}
          {!loading && filtered.map(m => <MemoryCard key={m.id} m={m} onExpire={async () => { await apiPost('/memory/expire', { id: m.id }); setItems(arr => arr.map(x => x.id === m.id ? { ...x, status: 'expired' } : x)); }} onDelete={async () => { await apiPost('/memory/delete', { id: m.id }); setItems(arr => arr.filter(x => x.id !== m.id)); }} />)}
        </div>
      </div>

      <PendingSheet open={showPending} onClose={() => setShowPending(false)} items={pending} onAccept={async (id) => { await apiPost('/memory/pending/accept', { id }); setPending(p => p.filter(x => x.id !== id)); showToast('已保存', 'success'); loadAll(); }} onReject={async (id) => { await apiPost('/memory/pending/reject', { id }); setPending(p => p.filter(x => x.id !== id)); }} />
      <CreateSheet open={showCreate} onClose={() => setShowCreate(false)} onCreate={(m) => { setItems(arr => [m, ...arr]); showToast('已添加', 'success'); }} />
    </>
  );
}
