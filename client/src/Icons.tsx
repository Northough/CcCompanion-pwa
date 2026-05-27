import React from 'react';

const I = ({ d, size = 22, s = 1.6, fill = 'none', children, style }: { d?: string; size?: number; s?: number; fill?: string; children?: React.ReactNode; style?: React.CSSProperties }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke="currentColor" strokeWidth={s} strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, ...style }}>
    {d ? <path d={d} /> : children}
  </svg>
);

export const IconMenu = (p: any) => <I {...p}><line x1="4" y1="7" x2="20" y2="7"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="17" x2="14" y2="17"/></I>;
export const IconClose = (p: any) => <I {...p}><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></I>;
export const IconPlus = (p: any) => <I {...p}><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></I>;
export const IconSend = (p: any) => <I {...p} fill="currentColor" stroke="none"><path d="M5 12 L19 5 L15 12 L19 19 Z"/></I>;
export const IconChat = (p: any) => <I {...p}><path d="M21 12a8 8 0 1 1-3-6.2L21 4l-1 4.5A8 8 0 0 1 21 12z"/></I>;
export const IconChart = (p: any) => <I {...p}><line x1="4" y1="20" x2="20" y2="20"/><path d="M5 16 L9 11 L13 14 L19 6"/><circle cx="9" cy="11" r="1.2" fill="currentColor" stroke="none"/><circle cx="13" cy="14" r="1.2" fill="currentColor" stroke="none"/><circle cx="19" cy="6" r="1.2" fill="currentColor" stroke="none"/></I>;
export const IconCog = (p: any) => <I {...p}><circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1.3l2-1.5-2-3.4-2.3 1a7 7 0 0 0-2.3-1.3L14 3h-4l-.3 2.5a7 7 0 0 0-2.3 1.3l-2.3-1-2 3.4 2 1.5A7 7 0 0 0 5 12c0 .5 0 .9.1 1.3l-2 1.5 2 3.4 2.3-1c.7.6 1.5 1 2.3 1.3L10 21h4l.3-2.5c.8-.3 1.6-.7 2.3-1.3l2.3 1 2-3.4-2-1.5c.1-.4.1-.8.1-1.3z"/></I>;
export const IconCopy = (p: any) => <I {...p}><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/></I>;
export const IconStar = (p: any) => <I {...p}><polygon points="12 3 14.5 9 21 9.5 16 13.8 17.5 20 12 16.7 6.5 20 8 13.8 3 9.5 9.5 9"/></I>;
export const IconCheck = (p: any) => <I {...p}><polyline points="4 12 10 18 20 6"/></I>;
export const IconArrowUp = (p: any) => <I {...p}><line x1="12" y1="5" x2="12" y2="19"/><polyline points="5 12 12 5 19 12"/></I>;
export const IconRefresh = (p: any) => <I {...p}><polyline points="3 12 3 6 9 6"/><path d="M3 6a9 9 0 0 1 15 3"/><polyline points="21 12 21 18 15 18"/><path d="M21 18a9 9 0 0 1-15-3"/></I>;
export const IconTerminal = (p: any) => <I {...p}><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></I>;
export const IconImage = (p: any) => <I {...p}><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.6"/><polyline points="3 17 9 12 13 16 17 12 21 16"/></I>;
export const IconFile = (p: any) => <I {...p}><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><polyline points="14 3 14 8 19 8"/></I>;
export const IconServer = (p: any) => <I {...p}><rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><circle cx="7" cy="7.5" r="0.8" fill="currentColor" stroke="none"/><circle cx="7" cy="16.5" r="0.8" fill="currentColor" stroke="none"/></I>;
export const IconKey = (p: any) => <I {...p}><circle cx="8" cy="14" r="4"/><path d="M11 12l8-8"/><line x1="16" y1="7" x2="19" y2="10"/></I>;
export const IconChevDown = (p: any) => <I {...p}><polyline points="6 9 12 15 18 9"/></I>;
export const IconChevRight = (p: any) => <I {...p}><polyline points="9 6 15 12 9 18"/></I>;
export const IconDot = ({ size = 8, color = 'currentColor' }: { size?: number; color?: string }) => (
  <span style={{ width: size, height: size, borderRadius: '50%', background: color, display: 'inline-block' }} />
);
export const IconBrain = (p: any) => <I {...p}><path d="M9 4a3 3 0 0 0-3 3v1a3 3 0 0 0-2 5 3 3 0 0 0 2 5v1a3 3 0 0 0 6 0V4a3 3 0 0 0-3 0z"/><path d="M15 4a3 3 0 0 1 3 3v1a3 3 0 0 1 2 5 3 3 0 0 1-2 5v1a3 3 0 0 1-6 0"/></I>;
export const IconSearch = (p: any) => <I {...p}><circle cx="11" cy="11" r="6.5"/><line x1="16" y1="16" x2="20.5" y2="20.5"/></I>;
export const IconEdit = (p: any) => <I {...p}><path d="M4 20h4l11-11-4-4L4 16z"/><line x1="14" y1="6" x2="18" y2="10"/></I>;
export const IconTrash = (p: any) => <I {...p}><polyline points="4 7 20 7"/><path d="M9 7V4h6v3"/><path d="M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13"/></I>;
export const IconClock = (p: any) => <I {...p}><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/></I>;
export const IconInbox = (p: any) => <I {...p}><polyline points="4 13 9 13 11 16 13 16 15 13 20 13"/><path d="M4 13l3-8h10l3 8v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/></I>;
export const IconDatabase = (p: any) => <I {...p}><ellipse cx="12" cy="5.5" rx="8" ry="2.5"/><path d="M4 5.5v6c0 1.4 3.6 2.5 8 2.5s8-1.1 8-2.5v-6"/><path d="M4 11.5v6c0 1.4 3.6 2.5 8 2.5s8-1.1 8-2.5v-6"/></I>;
export const IconReindex = (p: any) => <I {...p}><path d="M4 4v6h6"/><path d="M20 20v-6h-6"/><path d="M4 10a8 8 0 0 1 14-3"/><path d="M20 14a8 8 0 0 1-14 3"/></I>;
export const IconBeaker = (p: any) => <I {...p}><path d="M9 3v6L4 19a2 2 0 0 0 2 3h12a2 2 0 0 0 2-3L15 9V3"/><line x1="8" y1="3" x2="16" y2="3"/><line x1="7" y1="14" x2="17" y2="14"/></I>;
export const IconBolt = (p: any) => <I {...p}><polygon points="13 3 4 14 11 14 10 21 20 9 13 9"/></I>;
export const IconLock = (p: any) => <I {...p}><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></I>;
export const IconTool = (p: any) => <I {...p}><path d="M14 7a4 4 0 0 0 5 5l2 2-7 7-2-2a4 4 0 0 0-5-5L4 12l7-7z"/></I>;
export const IconThumbUp = (p: any) => <I {...p}><path d="M7 10v10H4V10z"/><path d="M7 10l4-7a2 2 0 0 1 2 2v4h6a2 2 0 0 1 2 2l-1.5 7a2 2 0 0 1-2 1.5H7"/></I>;
export const IconThumbDown = (p: any) => <I {...p}><path d="M7 14V4H4v10z"/><path d="M7 14l4 7a2 2 0 0 0 2-2v-4h6a2 2 0 0 0 2-2l-1.5-7a2 2 0 0 0-2-1.5H7"/></I>;
export const IconSpeak = (p: any) => <I {...p}><path d="M5 9v6h3l5 4V5L8 9H5z"/><path d="M16 9a4 4 0 0 1 0 6"/></I>;
export const IconWave = (p: any) => <I {...p}><line x1="4" y1="12" x2="4" y2="12"/><line x1="8" y1="9" x2="8" y2="15"/><line x1="12" y1="5" x2="12" y2="19"/><line x1="16" y1="8" x2="16" y2="16"/><line x1="20" y1="11" x2="20" y2="13"/></I>;
export const IconUsers = (p: any) => <I {...p}><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></I>;
