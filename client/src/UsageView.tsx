import { useState, useEffect } from 'react';
import { apiGet } from './api';
import { IconMenu, IconRefresh } from './Icons';
import { TopBar, IconButton } from './Shell';

function fmt(n: number | null | undefined) {
  if (n == null) return '—';
  if (n < 1000) return String(n);
  if (n < 10000) return (n / 1000).toFixed(1) + 'K';
  if (n < 1000000) return Math.round(n / 1000) + 'K';
  return (n / 1000000).toFixed(1) + 'M';
}

function fmtReset(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    const now = new Date();
    const diffMs = d.getTime() - now.getTime();
    if (diffMs <= 0) return '已重置';
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 60) return `${diffMin}min`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h${diffMin % 60}m`;
    return d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch { return iso; }
}

function QuotaBar({ label, pct, resetsAt, sub }: { label: string; pct: number | null; resetsAt?: string | null; sub?: string }) {
  const p = pct ?? 0;
  const color = p > 90 ? 'var(--bad)' : p > 70 ? 'var(--warn)' : 'var(--good)';
  return (
    <div className="stat-card" style={{ gap: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span className="stat-label">{label}</span>
        {sub && <span style={{ fontSize: 10, color: 'var(--dim)', fontFamily: 'var(--font-mono)' }}>{sub}</span>}
      </div>
      <div style={{ fontSize: 26, fontWeight: 800, color, fontFamily: 'var(--font-mono)', letterSpacing: '-0.03em' }}>
        {pct != null ? `${pct}%` : '—'}
      </div>
      <div style={{ height: 6, borderRadius: 999, background: 'var(--bg-2)', overflow: 'hidden' }}>
        <div style={{ width: `${Math.min(p, 100)}%`, height: '100%', background: color, borderRadius: 999, transition: 'width 0.4s' }} />
      </div>
      {resetsAt && (
        <div style={{ fontSize: 11, color: 'var(--dim)', fontFamily: 'var(--font-mono)' }}>
          reset: {fmtReset(resetsAt)}
        </div>
      )}
    </div>
  );
}

export default function UsageView({ openSidebar, showToast }: { openSidebar: () => void; showToast: (m: string, t?: string) => void }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const fetchUsage = async () => {
    try { const d = await apiGet('/usage/active'); setData(d); } catch {} finally { setLoading(false); }
  };

  useEffect(() => { fetchUsage(); const i = setInterval(fetchUsage, 30000); return () => clearInterval(i); }, []);

  const q = data?.quota;
  const s = data?.stats;
  const quotaAvail = data?.quota_source === 'claude_statusline';
  const statsAvail = data?.stats_source === 'ccusage';

  return (
    <>
      <TopBar
        left={<IconButton onClick={openSidebar}><IconMenu /></IconButton>}
        center={<span className="topbar-title">Usage</span>}
        right={<IconButton onClick={() => { fetchUsage(); showToast('Refreshed', 'success'); }}><IconRefresh /></IconButton>}
      />
      <div className="scroll" style={{ flex: 1, padding: '4px 18px 28px', display: 'flex', flexDirection: 'column', gap: 14 }}>

        {/* Model headline */}
        {loading ? (
          <div style={{ height: 72, background: 'var(--surface-2)', borderRadius: 22, border: '1px solid var(--line)' }} />
        ) : (
          <div className="usage-headline">
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.55)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>Model</div>
              <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: '-0.01em' }}>{q?.model || '—'}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.55)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>Cost</div>
              <div style={{ fontSize: 18, fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
                {q?.total_cost_usd != null ? `$${q.total_cost_usd.toFixed(2)}` : s?.cost_usd != null ? `$${s.cost_usd.toFixed(2)}` : '—'}
              </div>
            </div>
          </div>
        )}

        {/* Quota section */}
        <div className="section-hdr">
          <span className="section-hdr-title">额度 Quota</span>
          <span className="section-hdr-sub">{quotaAvail ? 'live' : 'awaiting data'}</span>
        </div>

        {quotaAvail ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
            <QuotaBar label="5 Hour" pct={q?.five_hour?.used_percentage} resetsAt={q?.five_hour?.resets_at} sub="rate limit" />
            <QuotaBar label="7 Day" pct={q?.seven_day?.used_percentage} resetsAt={q?.seven_day?.resets_at} sub="rate limit" />
            <QuotaBar label="Context" pct={q?.context?.used_percentage} sub="used" />
            <div className="stat-card">
              <div className="stat-label">Context 剩余</div>
              <div className="stat-value" style={{ color: (q?.context?.remaining_percentage ?? 100) < 20 ? 'var(--bad)' : 'var(--good)' }}>
                {q?.context?.remaining_percentage != null ? `${q.context.remaining_percentage}%` : '—'}
              </div>
            </div>
          </div>
        ) : (
          <div style={{ background: 'var(--accent-tint)', border: '1px dashed var(--accent-soft)', borderRadius: 16, padding: 16, fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.5 }}>
            等待 Claude Code 下一次回复后刷新。<br />
            <span style={{ fontSize: 11, color: 'var(--dim)' }}>statusLine 数据在 Claude 回复时自动采集，不额外消耗额度。</span>
          </div>
        )}

        {/* Stats section */}
        <div className="section-hdr">
          <span className="section-hdr-title">统计 Stats</span>
          <span className="section-hdr-sub">{statsAvail ? 'ccusage' : 'unavailable'}</span>
        </div>

        {statsAvail && s ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
            <StatCard label="Total tokens" value={fmt(s.total_tokens)} />
            <StatCard label="Cost" value={`$${s.cost_usd?.toFixed(2) ?? '—'}`} />
            <StatCard label="Input" value={fmt(s.input_tokens)} />
            <StatCard label="Output" value={fmt(s.output_tokens)} />
            <StatCard label="Burn rate" value={s.burn_tokens_per_min ? `${(s.burn_tokens_per_min / 1000).toFixed(1)}K/min` : '—'} />
            <StatCard label="Remaining" value={s.projection_remaining_min ? `${s.projection_remaining_min}min` : '—'} />
          </div>
        ) : (
          <div style={{ background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 16, padding: 16, fontSize: 13, color: 'var(--dim)', textAlign: 'center' }}>
            本地统计未安装 · 运行 <code style={{ fontFamily: 'var(--font-mono)', fontSize: 12, background: 'var(--accent-tint)', padding: '1px 5px', borderRadius: 4 }}>npm i -g ccusage</code> 启用
          </div>
        )}

        <div style={{ textAlign: 'center', fontSize: 11, color: 'var(--dim)', fontFamily: 'var(--font-mono)', padding: '8px 0' }}>
          {data?.quota?.version && `v${data.quota.version} · `}auto-refresh 30s
        </div>
      </div>
    </>
  );
}

function StatCard({ label, value, tone }: { label: string; value: string | null; tone?: string }) {
  return (
    <div className="stat-card">
      <div className="stat-label">{label}</div>
      <div className="stat-value" style={tone === 'good' ? { color: 'var(--good)' } : undefined}>{value ?? '—'}</div>
    </div>
  );
}
