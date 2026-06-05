import { useState, useCallback } from 'react';
import ChatView from './ChatView';
import TerminalView from './TerminalView';
import UsageView from './UsageView';
import SettingsView from './SettingsView';
import MemoryView from './MemoryView';
import GroupView from './GroupView';
import StudyView from './StudyView';
import { Sidebar } from './Sidebar';
import { NavHandle, Toast } from './Shell';
import './App.css';

type Page = 'chat' | 'terminal' | 'usage' | 'settings' | 'memory' | 'group' | 'study';

function App() {
  const [page, setPage] = useState<Page>('chat');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [chatReloadKey, setChatReloadKey] = useState(0);
  const [toast, setToast] = useState({ message: '', tone: '', key: 0 });

  const showToast = useCallback((message: string, tone = '') => {
    setToast({ message, tone, key: Date.now() });
    setTimeout(() => setToast(t => ({ ...t, message: '' })), 1800);
  }, []);

  const goto = useCallback((p: Page) => { setPage(p); setSidebarOpen(false); }, []);
  const refreshChat = useCallback(() => setChatReloadKey(k => k + 1), []);
  const pageView = (() => {
    switch (page) {
      case 'chat': return <ChatView key={chatReloadKey} openSidebar={() => setSidebarOpen(true)} showToast={showToast} />;
      case 'terminal': return <TerminalView openSidebar={() => setSidebarOpen(true)} />;
      case 'study': return <StudyView openSidebar={() => setSidebarOpen(true)} showToast={showToast} />;
      case 'memory': return <MemoryView openSidebar={() => setSidebarOpen(true)} showToast={showToast} />;
      case 'usage': return <UsageView openSidebar={() => setSidebarOpen(true)} showToast={showToast} />;
      case 'settings': return <SettingsView openSidebar={() => setSidebarOpen(true)} showToast={showToast} />;
      case 'group': return <GroupView openSidebar={() => setSidebarOpen(true)} showToast={showToast} />;
      default: return null;
    }
  })();

  return (
    <div className="device">
      <div className="page-shell">{pageView}</div>

      <NavHandle />

      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} page={page} goto={goto} showToast={showToast} onChatChanged={refreshChat} />

      <Toast key={toast.key} message={toast.message} tone={toast.tone} />
    </div>
  );
}

export default App;
