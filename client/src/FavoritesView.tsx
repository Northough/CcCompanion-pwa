import { useState, useEffect } from 'react';
import { IconMenu, IconTrash } from './Icons';
import { TopBar, IconButton } from './Shell';
import { subscribeFavorites, removeFavorite, type Favorite } from './api/favoritesStore';

function fmtDate(ts?: string) {
  if (!ts) return '';
  try { return new Date(ts).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch { return ''; }
}

export default function FavoritesView({ openSidebar, showToast }: { openSidebar: () => void; showToast: (m: string, t?: string) => void }) {
  const [items, setItems] = useState<Favorite[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => subscribeFavorites(setItems), []);

  const remove = (fav: Favorite) => {
    const count = fav.refs?.length || 0;
    const label = (fav.type === 'collection' || count > 1) ? `这条合并收藏（${count} 条）` : '这条收藏';
    if (!window.confirm(`删除${label}？`)) return;
    removeFavorite(fav.id);
    showToast('已删除收藏', 'success');
  };
  const toggle = (id: string) => setExpanded(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return (
    <>
      <TopBar left={<IconButton onClick={openSidebar}><IconMenu /></IconButton>} center={<span className="topbar-title">Favorites</span>} right={<span style={{ width: 42 }} />} />
      <div className="scroll" style={{ flex: 1, padding: '10px 14px 24px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {items.length === 0 && <div className="study-empty">还没有收藏。在聊天里长按消息 → 收藏，或长按 → 多选 打包收藏。</div>}
        {items.map(fav => {
          const refs = fav.refs || [];
          const isCol = fav.type === 'collection' || refs.length > 1;
          const open = expanded.has(fav.id);
          const shown = isCol && !open ? refs.slice(0, 2) : refs;
          return (
            <div key={fav.id} className="fav-card">
              <div className="fav-card-head">
                <span className="fav-card-kind">{isCol ? `合并收藏 · ${refs.length} 条` : '收藏'}</span>
                <span className="fav-card-time">{fmtDate(fav.created_at)}</span>
                <button className="fav-del" aria-label="删除收藏" onClick={() => remove(fav)}><IconTrash size={15} /></button>
              </div>
              {shown.map((r, i) => (
                <div key={i} className={`fav-ref${r.role === 'user' ? ' is-user' : ''}`}>
                  <span className="fav-ref-role">{r.role === 'user' ? '我' : 'Ta'}</span>
                  <span className="fav-ref-text">{r.text}</span>
                </div>
              ))}
              {isCol && refs.length > 2 && (
                <button className="fav-more" onClick={() => toggle(fav.id)}>{open ? '收起' : `展开全部 ${refs.length} 条`}</button>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
