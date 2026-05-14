import { IconClose, IconPlus, IconChat, IconChart, IconCog, IconTerminal, IconBrain } from './Icons';
import { IconButton } from './Shell';
import { apiPost } from './api';

type Page = 'chat' | 'terminal' | 'usage' | 'settings' | 'memory';

export function Sidebar({ open, onClose, page, goto, showToast }: { open: boolean; onClose: () => void; page: Page; goto: (p: Page) => void; showToast?: (m: string, t?: string) => void }) {
  const newChat = async () => {
    try {
      const d = await apiPost('/chain/new_session', {});
      showToast?.(`新会话: ${d.session}`, 'success');
    } catch (e) {
      showToast?.(`创建失败: ${e}`, 'error');
    }
    goto('chat');
    onClose();
  };
  const nav = (p: Page) => { goto(p); onClose(); };
  return (
    <>
      <div className="sidebar-scrim" onClick={onClose} style={{ pointerEvents: open ? 'auto' : 'none', background: open ? 'rgba(20,16,12,0.42)' : 'transparent' }} />
      <aside className={`sidebar-drawer${open ? ' open' : ''}`}>
        <div style={{ padding: '16px 18px 8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 18, fontWeight: 800, letterSpacing: '-0.02em', color: 'var(--ink)' }}>Cc</span>
          <IconButton onClick={onClose}><IconClose size={20} /></IconButton>
        </div>
        <nav style={{ padding: '8px 8px', display: 'flex', flexDirection: 'column', gap: 2 }}>
          <button className="drawer-item accent" onClick={newChat}><IconPlus size={20} /><span>New chat</span></button>
          <button className={`drawer-item${page === 'chat' ? ' active' : ''}`} onClick={() => nav('chat')}><IconChat size={20} /><span>Chat</span></button>
          <button className={`drawer-item${page === 'terminal' ? ' active' : ''}`} onClick={() => nav('terminal')}><IconTerminal size={20} /><span>Terminal</span></button>
          <button className={`drawer-item${page === 'memory' ? ' active' : ''}`} onClick={() => nav('memory')}><IconBrain size={20} /><span>Memory</span></button>
          <button className={`drawer-item${page === 'usage' ? ' active' : ''}`} onClick={() => nav('usage')}><IconChart size={20} /><span>Usage</span></button>
          <button className={`drawer-item${page === 'settings' ? ' active' : ''}`} onClick={() => nav('settings')}><IconCog size={20} /><span>Settings</span></button>
        </nav>
        <div style={{ flex: 1 }} />
        <div style={{ padding: '10px 16px 24px', borderTop: '1px solid var(--line)', fontSize: 11, color: 'var(--dim)', textAlign: 'center' }}>
          Cc Companion · v1.0
        </div>
      </aside>
    </>
  );
}
