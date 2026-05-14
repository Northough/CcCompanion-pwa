import React from 'react';

export function TopBar({ left, center, right }: { left?: React.ReactNode; center?: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="topbar">
      <div style={{ width: 42, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{left}</div>
      <div className="topbar-center">{center}</div>
      <div style={{ width: 42, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{right}</div>
    </div>
  );
}

export function IconButton({ children, onClick, label, active }: { children: React.ReactNode; onClick?: () => void; label?: string; active?: boolean }) {
  return (
    <button className="icon-btn" onClick={onClick} aria-label={label} style={active ? { background: 'var(--accent-tint)' } : undefined}>
      {children}
    </button>
  );
}

export function NavHandle() {
  return <div className="nav-handle"><div className="nav-handle-bar" /></div>;
}

export function Toast({ message, tone }: { message: string; tone?: string }) {
  if (!message) return null;
  return <div className={`toast ${tone || ''}`}>{message}</div>;
}
