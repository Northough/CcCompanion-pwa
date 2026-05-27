import { useState, useCallback } from 'react';
import ChatView from './ChatView';
import TerminalView from './TerminalView';
import UsageView from './UsageView';
import SettingsView from './SettingsView';
import MemoryView from './MemoryView';
import GroupView from './GroupView';
import { Sidebar } from './Sidebar';
import { NavHandle, Toast } from './Shell';
import './App.css';

type Page = 'chat' | 'terminal' | 'usage' | 'settings' | 'memory' | 'group';

function App() {
  const [page, setPage] = useState<Page>('chat');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [toast, setToast] = useState({ message: '', tone: '', key: 0 });

  const showToast = useCallback((message: string, tone = '') => {
    setToast({ message, tone, key: Date.now() });
    setTimeout(() => setToast(t => ({ ...t, message: '' })), 1800);
  }, []);

  const goto = useCallback((p: Page) => { setPage(p); setSidebarOpen(false); }, []);

  return (
    <div className="device">
      {page === 'chat' && <ChatView openSidebar={() => setSidebarOpen(true)} showToast={showToast} />}
      {page === 'terminal' && <TerminalView openSidebar={() => setSidebarOpen(true)} />}
      {page === 'memory' && <MemoryView openSidebar={() => setSidebarOpen(true)} showToast={showToast} />}
      {page === 'usage' && <UsageView openSidebar={() => setSidebarOpen(true)} showToast={showToast} />}
      {page === 'settings' && <SettingsView openSidebar={() => setSidebarOpen(true)} showToast={showToast} />}
      {page === 'group' && <GroupView openSidebar={() => setSidebarOpen(true)} showToast={showToast} />}

      <NavHandle />

      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} page={page} goto={goto} showToast={showToast} />

      <Toast key={toast.key} message={toast.message} tone={toast.tone} />
    </div>
  );
}

export default App;
