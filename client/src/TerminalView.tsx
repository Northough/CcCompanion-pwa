import { useState, useEffect, useRef, useCallback } from 'react';
import { apiGet, apiPost } from './api';
import { IconMenu } from './Icons';
import { TopBar, IconButton } from './Shell';

export default function TerminalView({ openSidebar }: { openSidebar: () => void }) {
  const [content, setContent] = useState('');
  const [draft, setDraft] = useState('');
  const [session, setSession] = useState('cc');
  const [sessions, setSessions] = useState<string[]>([]);
  const [joined, setJoined] = useState(true);
  const [termSize, setTermSize] = useState('');
  const termRef = useRef<HTMLPreElement>(null);

  const fetchSessions = useCallback(async () => {
    try {
      const d = await apiGet('/chain/sessions');
      if (d.ok) {
        const nextSessions = Array.isArray(d.sessions) ? d.sessions : [];
        setSessions(nextSessions);
        setSession(prev => {
          if (d.active && nextSessions.includes(d.active)) return d.active;
          if (nextSessions.includes(prev)) return prev;
          return nextSessions[0] || prev;
        });
      }
    } catch {}
  }, []);

  const fetchCapture = useCallback(async () => {
    try {
      const d = await apiGet(`/tmux/capture?session=${encodeURIComponent(session)}&lines=160&join=${joined ? '1' : '0'}`);
      if (d.ok) {
        setContent(d.content || '');
        setTermSize(d.size || '');
      }
    } catch (e) {
      setContent(`(${session} session unavailable)\n${String(e)}`);
      setTermSize('');
    }
  }, [session, joined]);

  useEffect(() => {
    fetchSessions();
    fetchCapture();
    const i = setInterval(fetchCapture, 1500);
    return () => clearInterval(i);
  }, [fetchCapture, fetchSessions]);
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
        <div className="term-mode" aria-label="Terminal display mode">
          <button className={joined ? 'active' : ''} onClick={() => setJoined(true)}>Joined</button>
          <button className={!joined ? 'active' : ''} onClick={() => setJoined(false)}>Screen</button>
        </div>
        {termSize && <span className="term-size">{termSize}</span>}
      </div>
      <div className="term-toolbar secondary">
        <button className="term-btn" onClick={async () => { try { await apiPost('/chain/abort', { session }); } catch {} await fetchCapture(); }}>^C</button>
        <button className="term-btn" onClick={async () => { try { await apiPost('/tmux/send', { keys: 'Escape', session, enter: false }); } catch {} await fetchCapture(); }}>Esc</button>
        <button className="term-btn" onClick={async () => { try { await apiPost('/tmux/send', { keys: 'clear', session, enter: true }); } catch {} await fetchCapture(); }}>Clear</button>
        <button className="term-btn" onClick={() => sendKey('Tab')}>Tab</button>
        <button className="term-btn" onClick={() => sendKey('Enter')}>Enter</button>
      </div>
      <div className="term-keypad" aria-label="Terminal arrow keys">
        <button className="term-key term-key-left" onClick={() => sendKey('Left')} aria-label="Arrow left">←</button>
        <button className="term-key term-key-up" onClick={() => sendKey('Up')} aria-label="Arrow up">↑</button>
        <button className="term-key term-key-down" onClick={() => sendKey('Down')} aria-label="Arrow down">↓</button>
        <button className="term-key term-key-right" onClick={() => sendKey('Right')} aria-label="Arrow right">→</button>
      </div>
      <pre className={`term-output${joined ? ' joined' : ''}`} ref={termRef}>{content || '(无输出)'}</pre>
      <div className="term-input-bar">
        <input className="term-input" value={draft} onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); send(true); } }}
          placeholder="输入终端命令…" />
        <button className="term-send" onClick={() => send(true)}>Send</button>
      </div>
    </>
  );
}
