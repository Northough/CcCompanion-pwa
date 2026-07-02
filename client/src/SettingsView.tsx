import { useState, useEffect } from 'react';
import { apiGet, getServerUrl, setServerUrl, getSecret, setSecret } from './api';
import { IconMenu, IconDot } from './Icons';
import { TopBar, IconButton } from './Shell';
import { getProfile, saveProfile, notifyProfileChanged, readAvatarFile, type Profile } from './profile';
import { addCommand } from './api/commandTransport';
import { addLocalMessage, clearLocalMessages } from './api/localEcho';

/* ── Design-original building blocks ── */

function SettingsGroup({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="set-group">
      <div style={{ padding: '4px 6px 8px', display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)', letterSpacing: '-0.005em' }}>{title}</span>
        {subtitle && <span style={{ fontSize: 11, color: 'var(--dim)' }}>{subtitle}</span>}
      </div>
      <div style={{ background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 22, overflow: 'hidden' }}>
        {children}
      </div>
    </section>
  );
}

function SettingsRow({ label, right, last, tappable, onClick, children }: { label?: string; right?: React.ReactNode; last?: boolean; tappable?: boolean; onClick?: () => void; children?: React.ReactNode }) {
  if (children && !label) return <div style={{ padding: 12, borderTop: '1px solid var(--line)' }}>{children}</div>;
  return (
    <button onClick={onClick} disabled={!tappable} style={{
      width: '100%', padding: '12px 14px', minHeight: 46, background: 'transparent', border: 'none',
      borderBottom: last ? 'none' : '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 10,
      color: 'var(--ink)', textAlign: 'left', cursor: tappable ? 'pointer' : 'default'
    }}>
      {label && <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--ink)' }}>{label}</span>}
      <span style={{ flex: 1 }} />
      {right}
    </button>
  );
}

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button onClick={() => onChange(!on)} style={{
      width: 46, height: 28, borderRadius: 999, background: on ? 'var(--ink)' : 'var(--line-2)',
      border: 'none', padding: 3, position: 'relative', flexShrink: 0
    }}>
      <span style={{ position: 'absolute', top: 3, left: on ? 21 : 3, width: 22, height: 22, borderRadius: '50%', background: '#fff', transition: 'left 0.18s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)' }} />
    </button>
  );
}

function StatusBadge({ ok, label }: { ok: boolean; label: string }) {
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 700, color: ok ? 'var(--good)' : 'var(--bad)' }}><IconDot size={6} color="currentColor" />{label}</span>;
}

function Button({ children, onClick, loading }: { children: React.ReactNode; onClick?: () => void; loading?: boolean }) {
  return (
    <button onClick={onClick} disabled={loading} style={{
      padding: '11px 16px', borderRadius: 999, background: 'var(--ink)', border: 'none', color: 'var(--bg)',
      fontSize: 14, fontWeight: 600, fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, width: '100%'
    }}>
      {loading ? <span style={{ width: 14, height: 14, borderRadius: '50%', border: '2px solid currentColor', borderTopColor: 'transparent', animation: 'spin 0.8s linear infinite' }} /> : null}
      {children}
    </button>
  );
}

/* ── Main Settings Page ── */

export default function SettingsView({ openSidebar, showToast }: { openSidebar: () => void; showToast: (m: string, t?: string) => void }) {
  const [url, setUrl] = useState(getServerUrl());
  const [secret, setSecretState] = useState(getSecret());
  const [diag, setDiag] = useState<Record<string, any> | null>(null);
  const [profile, setProfile] = useState<Profile>(getProfile);
  const [commandMode, setCommandMode] = useState<'mock' | 'real'>(() => localStorage.getItem('cc_command_transport') === 'mock' ? 'mock' : 'real');

  const runDiag = async () => {
    try {
      const d = await apiGet('/diag');
      setDiag(d);
    } catch { setDiag({ ok: false, error: 'unreachable' }); }
  };

  useEffect(() => { runDiag(); }, []);

  const quickConnect = () => {
    const isLocal = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
    const serverUrl = isLocal ? '' : location.origin;
    setServerUrl(serverUrl); setSecret('');
    localStorage.setItem('cc_server_url', serverUrl);
    localStorage.setItem('cc_shared_secret', '');
    showToast(isLocal ? '已连接本机' : `已连接 ${serverUrl}`, 'success');
    setTimeout(runDiag, 300);
  };

  const updateProfile = (patch: Partial<Profile>) => { const next = { ...profile, ...patch }; setProfile(next); saveProfile(next); notifyProfileChanged(); };

  const pickAvatar = (key: 'userAvatar' | 'claudeAvatar') => {
    const input = document.createElement('input'); input.type = 'file'; input.accept = 'image/*';
    input.onchange = async () => { const f = input.files?.[0]; if (!f) return; try { updateProfile({ [key]: await readAvatarFile(f) }); } catch { showToast('图片加载失败', 'error'); } };
    input.click();
  };

  const connected = !!diag?.ok;
  const latMs = diag?.latency_ms ?? diag?.latency;

  return (
    <>
      <TopBar
        left={<IconButton onClick={openSidebar}><IconMenu /></IconButton>}
        center={<span className="topbar-title">Settings</span>}
        right={<span style={{ width: 42 }} />}
      />
      <div className="scroll" style={{ flex: 1, padding: '4px 18px 28px', display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* ── 1. Server connection ── */}
        <SettingsGroup title="服务器连接" subtitle="Server connection">
          <SettingsRow label="Server URL" right={<input className="set-input" style={{ maxWidth: 180, textAlign: 'right' }} type="url" value={url} onChange={e => setUrl(e.target.value)} placeholder="http://server:8795" />} />
          <SettingsRow label="连接状态" right={
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600, color: connected ? 'var(--good)' : 'var(--bad)' }}>
              <IconDot size={7} color="currentColor" />{connected ? 'Connected' : 'Disconnected'}
              {latMs != null && <span className="mono" style={{ color: 'var(--dim)', fontWeight: 500 }}>· {latMs}ms</span>}
            </span>
          } />
          <SettingsRow label="Shared Secret" right={<input className="set-input" style={{ maxWidth: 140, textAlign: 'right' }} type="password" value={secret} onChange={e => setSecretState(e.target.value)} placeholder="可选" />} />
          <SettingsRow last>
            <div style={{ display: 'flex', gap: 8, width: '100%', flexWrap: 'wrap' }}>
              <div style={{ flex: '1 1 88px' }}><Button onClick={() => { setServerUrl(url.replace(/\/+$/, '')); setSecret(secret); showToast('已保存', 'success'); }}>保存</Button></div>
              <div style={{ flex: '1 1 128px' }}><Button onClick={quickConnect}>一键连接本机</Button></div>
              <div style={{ flex: '1 1 108px' }}><Button onClick={() => { runDiag(); showToast('正在测试连接'); }}>测试连接</Button></div>
            </div>
          </SettingsRow>
        </SettingsGroup>

        {/* ── 2. Claude Code ── */}
        <SettingsGroup title="Claude Code" subtitle="Active session">
          <SettingsRow label="Active session" right={<span className="mono" style={{ fontSize: 13, color: 'var(--ink)', fontWeight: 600 }}>{diag?.active_session || '—'}</span>} />
          <SettingsRow label="Claude running" right={<StatusBadge ok={diag?.claude_running === true} label={diag?.claude_running ? 'Running' : 'Idle'} />} />
          <SettingsRow label="tmux" right={
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
              <StatusBadge ok={diag?.tmux_ok === true} label={diag?.tmux_ok ? 'OK' : 'FAIL'} />
              {(diag?.sessions?.length ?? 0) > 0 && <span className="mono" style={{ color: 'var(--dim)', fontSize: 11 }}>{diag!.sessions.length} sessions</span>}
            </span>
          } />
          <SettingsRow label="Chat history" right={<span className="mono" style={{ fontSize: 13, color: 'var(--muted)' }}>{diag?.history_count ?? '—'} msgs</span>} />
          <SettingsRow last label="Sessions" right={
            (diag?.sessions?.length ?? 0) > 0
              ? <span className="mono" style={{ fontSize: 12, color: 'var(--muted)' }}>{diag!.sessions.join(', ')}</span>
              : <span style={{ fontSize: 12, color: 'var(--dim)' }}>—</span>
          } />
        </SettingsGroup>

        {/* ── 3. Command float window ── */}
        <SettingsGroup title="指令浮窗" subtitle="Command float window">
          <SettingsRow label="演示模式" right={
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600 }}>{commandMode === 'mock' ? '开（自动推一条）' : '关（跟随对话）'}</span>
              <Toggle on={commandMode === 'mock'} onChange={v => {
                const next = v ? 'mock' : 'real';
                localStorage.setItem('cc_command_transport', next);
                setCommandMode(next);
                showToast(next === 'mock' ? '演示模式：开（刷新生效）' : '演示模式：关，跟随对话', 'success');
              }} />
            </span>
          } />
          <SettingsRow>
            <Button onClick={() => { addCommand(`test-${Date.now()}`, { title: '测试任务：喝口水再回来', countdown_seconds: 60 }); showToast('已弹出一个测试任务', 'success'); }}>弹一个测试任务</Button>
          </SettingsRow>
          <div style={{ padding: '4px 14px 12px', fontSize: 11.5, color: 'var(--dim)', lineHeight: 1.5 }}>
            正常时任务由 Claude 在回复里用 [[task:标题:秒]] 记号下达，浮窗自动弹出。点上面的按钮可立即弹一个测试任务（60 秒倒计时，任意页面都会出现）。
          </div>
        </SettingsGroup>

        {/* ── 4. UI preview helpers ── */}
        <SettingsGroup title="界面测试" subtitle="Preview helpers">
          <SettingsRow>
            <div style={{ display: 'flex', gap: 8, width: '100%' }}>
              <div style={{ flex: 1 }}><Button onClick={() => {
                addLocalMessage('assistant', '好，那先专注 25 分钟，读完回来找我。');
                addLocalMessage('user', '读完啦，比想象中快一点', { quoted_text: '好，那先专注 25 分钟，读完回来找我。' });
                showToast('已生成测试消息，去 Chat 看看', 'success');
              }}>生成测试聊天消息</Button></div>
              <div style={{ flex: 1 }}><Button onClick={() => { clearLocalMessages(); showToast('已清空本地测试消息', 'success'); }}>清空测试消息</Button></div>
            </div>
          </SettingsRow>
          <div style={{ padding: '4px 14px 12px', fontSize: 11.5, color: 'var(--dim)', lineHeight: 1.5 }}>
            生成一条 AI 消息和一条带引用的用户消息，用于离线预览气泡对齐、时间与引用块（存在本地，刷新仍在）。
          </div>
        </SettingsGroup>

        {/* ── 4. Profile ── */}
        <SettingsGroup title="个人资料" subtitle="Profile">
          <div style={{ padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 14, borderBottom: '1px solid var(--line)' }}>
            <div onClick={() => pickAvatar('userAvatar')} style={{ width: 48, height: 48, borderRadius: '50%', background: profile.userAvatar ? 'transparent' : 'var(--accent)', border: profile.userAvatar ? '1px solid var(--line)' : 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', cursor: 'pointer', flexShrink: 0 }}>
              {profile.userAvatar ? <img src={profile.userAvatar} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }} /> : <span style={{ fontSize: 20, fontWeight: 800, color: '#fff' }}>{profile.userName.charAt(0).toUpperCase()}</span>}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600, marginBottom: 4 }}>我的名字</div>
              <input className="set-input" value={profile.userName} onChange={e => updateProfile({ userName: e.target.value || 'Me' })} placeholder="Me" />
            </div>
          </div>
          <div style={{ padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 14 }}>
            <div onClick={() => pickAvatar('claudeAvatar')} style={{ width: 48, height: 48, borderRadius: '50%', background: profile.claudeAvatar ? 'transparent' : 'var(--ink)', border: profile.claudeAvatar ? '1px solid var(--line)' : 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', cursor: 'pointer', flexShrink: 0 }}>
              {profile.claudeAvatar ? <img src={profile.claudeAvatar} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }} /> : <span style={{ fontSize: 20, fontWeight: 800, color: 'var(--bg)' }}>C</span>}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600, marginBottom: 4 }}>Claude 显示名</div>
              <input className="set-input" value={profile.claudeName} onChange={e => updateProfile({ claudeName: e.target.value || 'Claude' })} placeholder="Claude" />
            </div>
          </div>
        </SettingsGroup>

        <div style={{ textAlign: 'center', fontSize: 11, color: 'var(--dim)', fontFamily: 'var(--font-mono)' }}>
          Cc Companion · v1.0
        </div>
      </div>
    </>
  );
}

