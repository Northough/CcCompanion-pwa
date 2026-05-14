import { useState, useEffect, useRef, useCallback } from 'react';
import { apiGet, apiPost } from './api';
import { IconMenu } from './Icons';
import { TopBar, IconButton } from './Shell';

export default function TerminalView({ openSidebar }: { openSidebar: () => void }) {
  const [content, setContent] = useState('');
  const [draft, setDraft] = useState('');
  const [session, setSession] = useState('cc');
  const [sessions, setSessions] = useState<string[]>([]);
  const termRef = useRef<HTMLPreElement>(null);

  const fetchSessions = useCallback(async () => {
    try {
      const d = await apiGet('/chain/sessions');
      if (d.ok) {
        setSessions(d.sessions);
        setSession(prev => d.active || (d.sessions?.includes(prev) ? prev : d.sessions?.[0] || prev));
      }
    } catch {}
  }, []);

  const fetchCapture = useCallback(async () => {
    try { const d = await apiGet(`/tmux/capture?session=${session}&lines=120`); if (d.ok && d.content) setContent(d.content); } catch {}
  }, [session]);

  useEffect(() => { fetchSessions(); const i = setInterval(fetchCapture, 1500); return () => clearInterval(i); }, [fetchCapture, fetchSessions]);
  useEffect(() => { if (termRef.current) termRef.current.scrollTop = termRef.current.scrollHeight; }, [content]);

  const send = async (enter = true) => {
    try { await apiPost('/tmux/send', { keys: draft, session, enter }); if (enter) setDraft(''); await fetchCapture(); } catch (e) { alert(`发送失败: ${e}`); }
  };

  const sendKey = async (key: string) => {
    try { await apiPost('/tmux/send', { keys: key, session, enter: false }); await fetchCapture(); } catch (e) { alert(`发送失败: ${e}`); }
  };

  return (
    <>
      <TopBar left={<IconButton onClick={openSidebar}><IconMenu /></IconButton>} center={<span className="topbar-title">Terminal</span>} right={<span style={{ width: 42 }} />} />
      <div className="term-toolbar">
        <select className="term-select" value={session} onChange={e => setSession(e.target.value)}>
          {sessions.length > 0 ? sessions.map(s => <option key={s} value={s}>{s}</option>) : <option value={session}>{session}</option>}
        </select>
        <button className="term-btn" onClick={async () => { try { await apiPost('/chain/abort', { session }); } catch {} await fetchCapture(); }}>^C</button>
        <button className="term-btn" onClick={async () => { try { await apiPost('/tmux/send', { keys: 'Escape', session, enter: false }); } catch {} await fetchCapture(); }}>Esc</button>
        <button className="term-btn" onClick={async () => { try { await apiPost('/tmux/send', { keys: 'clear', session, enter: true }); } catch {} await fetchCapture(); }}>Clear</button>
      </div>
      <div className="term-keypad" aria-label="Terminal arrow keys">
        <span className="term-keypad-spacer" />
        <button className="term-key" onClick={() => sendKey('Up')} aria-label="Arrow up">↑</button>
        <span className="term-keypad-spacer" />
        <button className="term-key" onClick={() => sendKey('Left')} aria-label="Arrow left">←</button>
        <button className="term-key" onClick={() => sendKey('Down')} aria-label="Arrow down">↓</button>
        <button className="term-key" onClick={() => sendKey('Right')} aria-label="Arrow right">→</button>
        <button className="term-key wide" onClick={() => sendKey('Tab')} aria-label="Tab">Tab</button>
        <button className="term-key wide" onClick={() => sendKey('Enter')} aria-label="Enter">Enter</button>
      </div>
      <pre className="term-output" ref={termRef}>{content || '(无输出)'}</pre>
      <div className="term-input-bar">
        <input className="term-input" value={draft} onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); send(true); } }}
          placeholder="输入终端命令…" />
        <button className="composer-send active" onClick={() => send(true)}><span style={{ fontSize: 12, fontWeight: 700 }}>Send</span></button>
      </div>
    </>
  );
}
