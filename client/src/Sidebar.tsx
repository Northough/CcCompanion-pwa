import { useEffect, useState, useCallback } from 'react';
import { IconClose, IconPlus, IconChat, IconChart, IconCog, IconTerminal, IconClock, IconUsers, IconDatabase, IconTrash, IconStar } from './Icons';
import { IconButton } from './Shell';
import { apiGet, apiPost } from './api';

type Page = 'chat' | 'terminal' | 'usage' | 'settings' | 'schedule' | 'group' | 'study' | 'favorites';
interface Conversation { id: string; title: string; preview?: string; updated_at?: string; message_count?: number; active?: boolean; tmux_session?: string }

function fmtConversationTime(ts?: string) {
  if (!ts) return '';
  try {
    const d = new Date(ts);
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}

export function Sidebar({ open, onClose, page, goto, showToast, onChatChanged }: { open: boolean; onClose: () => void; page: Page; goto: (p: Page) => void; showToast?: (m: string, t?: string) => void; onChatChanged?: () => void }) {
  const [conversations, setConversations] = useState<Conversation[]>([]);

  const loadConversations = useCallback(async () => {
    try {
      const d = await apiGet('/chat/conversations?limit=80');
      if (d.ok && Array.isArray(d.conversations)) setConversations(d.conversations);
    } catch {}
  }, []);

  useEffect(() => { if (open) loadConversations(); }, [open, loadConversations]);

  const newChat = async () => {
    try {
      const d = await apiPost('/chain/new_session', {});
      showToast?.(`新会话: ${d.session}`, 'success');
      await loadConversations();
      onChatChanged?.();
    } catch (e) {
      showToast?.(`创建失败: ${e}`, 'error');
    }
    goto('chat');
    onClose();
  };
  const openConversation = async (id: string) => {
    try {
      await apiPost('/chat/switch', { conversation_id: id });
      await loadConversations();
      onChatChanged?.();
      goto('chat');
      onClose();
    } catch (e) {
      showToast?.(`切换失败: ${e}`, 'error');
    }
  };
  const deleteConversation = async (c: Conversation) => {
    const label = c.title || c.id;
    if (!window.confirm(`删除会话「${label}」？`)) return;
    try {
      await apiPost('/chat/conversation/delete', { conversation_id: c.id, kill_tmux: true });
      showToast?.('已删除会话', 'success');
      await loadConversations();
      onChatChanged?.();
    } catch (e) {
      showToast?.(`删除失败: ${e}`, 'error');
    }
  };
  const nav = (p: Page) => { goto(p); onClose(); };
  return (
    <>
      <div className="sidebar-scrim" onClick={onClose} style={{ pointerEvents: open ? 'auto' : 'none', background: open ? 'rgba(28,28,26,0.36)' : 'transparent' }} />
      <aside className={`sidebar-drawer${open ? ' open' : ''}`}>
        <div style={{ padding: '12px 10px 8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--line)' }}>
          <span style={{ width: 42, flexShrink: 0 }} />
          <span style={{ fontSize: 18, fontWeight: 800, letterSpacing: '0.05em', color: '#a2764f' }}>Functions</span>
          <IconButton onClick={onClose}><IconClose size={20} /></IconButton>
        </div>
        <nav className="sidebar-nav sidebar-primary">
          <button className="drawer-item accent" onClick={newChat}><IconPlus size={20} /><span>New chat</span></button>
          <button className={`drawer-item${page === 'chat' ? ' active' : ''}`} onClick={() => nav('chat')}><IconChat size={20} /><span>Chat</span></button>
        </nav>
        <div className="sidebar-history">
          {conversations.length > 0 && (
            <div className="conversation-list">
              {conversations.map(c => (
                <div key={c.id} className={`conversation-item${c.active ? ' active' : ''}`}>
                  <button className="conversation-main" onClick={() => openConversation(c.id)}>
                    <span className="conversation-title">{c.title || c.id}</span>
                    <span className="conversation-meta">
                      <span>{c.preview || c.tmux_session || c.id}</span>
                      <span>{fmtConversationTime(c.updated_at)}</span>
                    </span>
                  </button>
                  <button className="conversation-delete" aria-label={`Delete ${c.title || c.id}`} onClick={() => deleteConversation(c)}>
                    <IconTrash size={15} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
        <nav className="sidebar-nav sidebar-secondary">
          <button className={`drawer-item${page === 'study' ? ' active' : ''}`} onClick={() => nav('study')}><IconDatabase size={20} /><span>Study</span></button>
          <button className={`drawer-item${page === 'terminal' ? ' active' : ''}`} onClick={() => nav('terminal')}><IconTerminal size={20} /><span>Terminal</span></button>
          <button className={`drawer-item${page === 'schedule' ? ' active' : ''}`} onClick={() => nav('schedule')}><IconClock size={20} /><span>Schedule</span></button>
          <button className={`drawer-item${page === 'favorites' ? ' active' : ''}`} onClick={() => nav('favorites')}><IconStar size={20} /><span>Favorites</span></button>
          <button className={`drawer-item${page === 'group' ? ' active' : ''}`} onClick={() => nav('group')}><IconUsers size={20} /><span>Group</span></button>
          <button className={`drawer-item${page === 'usage' ? ' active' : ''}`} onClick={() => nav('usage')}><IconChart size={20} /><span>Usage</span></button>
          <button className={`drawer-item${page === 'settings' ? ' active' : ''}`} onClick={() => nav('settings')}><IconCog size={20} /><span>Settings</span></button>
        </nav>
        <div style={{ padding: '10px 16px 24px', borderTop: '1px solid var(--line)', fontSize: 11, color: 'var(--dim)', textAlign: 'center' }}>
          Cc Companion · v1.0
        </div>
      </aside>
    </>
  );
}
