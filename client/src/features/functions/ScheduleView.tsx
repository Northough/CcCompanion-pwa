import { useEffect, useMemo, useState } from 'react';
import { IconClock, IconEdit, IconMenu, IconPlus, IconTrash } from '../../Icons';
import { IconButton, TopBar } from '../../Shell';
import type { ScheduleItem, ScheduleStatus } from './types';
import './functions.css';

const LOCAL_SCHEDULE_KEY = 'cccompanion:function:schedule:v1';

function todayString(offset = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function makeId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
}

function formatDate(value: string) {
  const d = new Date(`${value}T00:00:00`);
  if (Number.isNaN(d.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' }).format(d);
}

function statusLabel(status: string) {
  return ({ pending: '待处理', done: '已完成', expired: '过期' } as Record<string, string>)[status] || status;
}

function defaultLocalSchedule(): ScheduleItem[] {
  return [{
    id: 'local_schedule_weekly',
    date: todayString(),
    title: '写周报摘要',
    starts_at: '14:00',
    ends_at: '14:40',
    status: 'pending',
    type: 'todo',
    note: '先写要点，再补细节。',
    subtasks: [
      { id: 'local_schedule_weekly_1', title: '列出三件完成事项', done: true },
      { id: 'local_schedule_weekly_2', title: '补风险和下周计划', done: false },
    ],
    created_by: 'local',
  }];
}

function loadLocalSchedule(): ScheduleItem[] {
  try {
    const raw = localStorage.getItem(LOCAL_SCHEDULE_KEY);
    if (!raw) return defaultLocalSchedule();
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : defaultLocalSchedule();
  } catch {
    return defaultLocalSchedule();
  }
}

function saveLocalSchedule(items: ScheduleItem[]) {
  localStorage.setItem(LOCAL_SCHEDULE_KEY, JSON.stringify(items));
}

// 进页面时清理"过去日期"的待办，避免它们变成看不见也删不掉的孤儿数据：
//   · 已完成 → 直接清掉（历史遗留的 expired 状态也一并清掉）
//   · 还没完成(pending) → 挪到"稍后 / 未安排"收件箱(date 置空)，保持可见可操作
function cleanupSchedule(items: ScheduleItem[]): ScheduleItem[] {
  const today = todayString();
  const out: ScheduleItem[] = [];
  for (const item of items) {
    const isPast = !!item.date && item.date < today; // YYYY-MM-DD 可直接字符串比较
    if (isPast && item.status === 'pending') {
      out.push({ ...item, date: '' });
    } else if (isPast) {
      continue; // 过去且已完成/已过期 → 丢弃
    } else {
      out.push(item);
    }
  }
  return out;
}

function EmptyBlock({ title, body }: { title: string; body?: string }) {
  return (
    <div className="function-empty">
      <strong>{title}</strong>
      {body && <p>{body}</p>}
    </div>
  );
}

function ScheduleCircle({ done = false }: { done?: boolean }) {
  return <span className={`function-circle${done ? ' is-done' : ''}`} aria-hidden="true" />;
}

export default function ScheduleView({ openSidebar, showToast }: { openSidebar: () => void; showToast?: (m: string, t?: string) => void }) {
  const [schedule, setSchedule] = useState<ScheduleItem[]>(() => cleanupSchedule(loadLocalSchedule()));
  const [activeDate, setActiveDate] = useState(todayString());
  const [newTodoTitle, setNewTodoTitle] = useState('');
  const [editingSchedule, setEditingSchedule] = useState<ScheduleItem | null>(null);

  useEffect(() => { saveLocalSchedule(schedule); }, [schedule]);

  const dateTabs = useMemo(() => [
    { label: '今天', value: todayString() },
    { label: '明天', value: todayString(1) },
    { label: '后天', value: todayString(2) },
    { label: '三天后', value: todayString(3) },
    { label: '四天后', value: todayString(4) },
  ], []);

  // 有日期且有时间 → 归入当日的时间轴
  const timedItems = useMemo(
    () => schedule
      .filter(item => item.date === activeDate && item.starts_at)
      .sort((a, b) => (a.starts_at || '').localeCompare(b.starts_at || '')),
    [activeDate, schedule],
  );
  // "稍后/未安排" = 没被钉到某天时间轴上的项：
  //   · 完全没日期的（不管有没有时间，作为全局收件箱，各 tab 都可见）
  //   · 本日有日期但没时间的
  // 有时间但没日期的会命中第一条，保留时间、继续留在这里，而不是消失
  const laterItems = useMemo(
    () => schedule.filter(item => !item.date || (item.date === activeDate && !item.starts_at)),
    [activeDate, schedule],
  );
  const visibleSchedule = useMemo(() => [...timedItems, ...laterItems], [timedItems, laterItems]);
  const nextItem = timedItems.find(item => item.status === 'pending');
  const pendingCount = visibleSchedule.filter(item => item.status === 'pending').length;
  const doneCount = visibleSchedule.filter(item => item.status === 'done').length;

  function addSchedule(event: React.FormEvent) {
    event.preventDefault();
    const title = newTodoTitle.trim();
    if (!title) return;
    // 新建默认落在"稍后/未安排"：不给默认时间和日期，等用户主动排期
    setSchedule(items => [...items, {
      id: makeId('schedule'),
      title,
      date: '',
      starts_at: '',
      ends_at: '',
      status: 'pending',
      type: 'todo',
      note: '',
      subtasks: [],
      created_by: 'local',
    }]);
    setNewTodoTitle('');
    showToast?.('已添加到稍后 / 未安排', 'success');
  }

  function setScheduleStatus(item: ScheduleItem, status: ScheduleStatus) {
    setSchedule(items => items.map(current => current.id === item.id ? { ...current, status } : current));
    setEditingSchedule(current => current && current.id === item.id ? { ...current, status } : current);
  }

  function saveScheduleEdit(item: ScheduleItem, patch: Partial<ScheduleItem>) {
    setSchedule(items => items.map(current => current.id === item.id ? { ...current, ...patch } : current));
    setEditingSchedule(null);
    showToast?.('已保存', 'success');
  }

  function deleteSchedule(item: ScheduleItem) {
    setSchedule(items => items.filter(current => current.id !== item.id));
    setEditingSchedule(null);
    showToast?.('已删除', 'success');
  }

  function toggleLocalSubtask(item: ScheduleItem, subtaskId: string) {
    const next = {
      ...item,
      subtasks: (item.subtasks || []).map(subtask => subtask.id === subtaskId ? { ...subtask, done: !subtask.done } : subtask),
    };
    setSchedule(items => items.map(current => current.id === item.id ? next : current));
    setEditingSchedule(next);
  }

  return (
    <>
      <TopBar
        left={<IconButton onClick={openSidebar}><IconMenu /></IconButton>}
        center={<span className="topbar-title">Schedule</span>}
        right={<IconClock size={20} />}
      />

      <main className="function-root">
        <section className="function-page schedule-page is-single">
          <header className="function-page-header">
            <div>
              <h1>日程</h1>
              <p>{formatDate(activeDate)}</p>
            </div>
          </header>

          <section className="schedule-summary">
            <p>待办 {pendingCount} 件 · 已完成 {doneCount} 件 · 下一项 {nextItem?.starts_at || '暂无'}</p>
            <blockquote>“先做一件最小的事。”</blockquote>
          </section>

          <nav className="schedule-date-tabs" aria-label="日期筛选">
            {dateTabs.map(tab => (
              <button key={tab.value} className={activeDate === tab.value ? 'is-active' : ''} onClick={() => setActiveDate(tab.value)}>
                {tab.label}
              </button>
            ))}
          </nav>

          <form className="schedule-add-row" onSubmit={addSchedule}>
            <IconPlus size={17} />
            <input value={newTodoTitle} placeholder="添加事件" onChange={e => setNewTodoTitle(e.target.value)} />
            <button type="submit" disabled={!newTodoTitle.trim()}>添加</button>
          </form>

          <section className="schedule-section">
            <h2>下一项</h2>
            {nextItem ? (
              <button className="schedule-next-card" onClick={() => setEditingSchedule(nextItem)}>
                <ScheduleCircle />
                <div><time>{nextItem.starts_at}</time><strong>{nextItem.title}</strong></div>
              </button>
            ) : <EmptyBlock title="暂无下一项" body="今天的待办暂时清空了。" />}
          </section>

          <section className="schedule-section">
            <h2>{dateTabs.find(tab => tab.value === activeDate)?.label || '当日'}</h2>
            <div className="schedule-list">
              {timedItems.map(item => (
                <article className={`schedule-row status-${item.status}`} key={item.id}>
                  <button className="schedule-row-check" onClick={() => setScheduleStatus(item, item.status === 'done' ? 'pending' : 'done')} aria-label="切换完成状态">
                    <ScheduleCircle done={item.status === 'done'} />
                  </button>
                  <button className="schedule-row-main" onClick={() => setEditingSchedule(item)}>
                    <span><time>{item.starts_at}</time><small>{statusLabel(item.status)}</small></span>
                    <strong>{item.title}</strong>
                  </button>
                </article>
              ))}
              {timedItems.length === 0 && <EmptyBlock title="暂无日程" body="可以添加一件事。" />}
            </div>
          </section>

          <section className="schedule-section">
            <h2>稍后 / 未安排</h2>
            <div className="schedule-later-list">
              {laterItems.map(item => (
                <button key={item.id} onClick={() => setEditingSchedule(item)}>
                  <span>{item.starts_at || '-'}</span><strong>{item.title}</strong><small>{statusLabel(item.status)}</small>
                </button>
              ))}
              {laterItems.length === 0 && <EmptyBlock title="暂无未安排事项" />}
            </div>
          </section>
        </section>
      </main>

      {editingSchedule && (
        <ScheduleEditor
          item={editingSchedule}
          onClose={() => setEditingSchedule(null)}
          onSave={patch => saveScheduleEdit(editingSchedule, patch)}
          onStatus={status => setScheduleStatus(editingSchedule, status)}
          onToggleSubtask={subtaskId => toggleLocalSubtask(editingSchedule, subtaskId)}
          onDelete={() => deleteSchedule(editingSchedule)}
        />
      )}
    </>
  );
}

function ScheduleEditor({
  item,
  onClose,
  onSave,
  onStatus,
  onToggleSubtask,
  onDelete,
}: {
  item: ScheduleItem;
  onClose: () => void;
  onSave: (patch: Partial<ScheduleItem>) => void;
  onStatus: (status: ScheduleStatus) => void;
  onToggleSubtask: (subtaskId: string) => void;
  onDelete: () => void;
}) {
  const [draft, setDraft] = useState({
    title: item.title,
    date: item.date,
    starts_at: item.starts_at || '',
    ends_at: item.ends_at || '',
    note: item.note || '',
  });

  return (
    <div className="function-sheet-layer" onClick={onClose}>
      <section className="function-sheet" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()}>
        <button className="function-sheet-handle" onClick={onClose} aria-label="关闭" />
        <div className="function-sheet-body">
          <header className="function-sheet-heading">
            <span>{item.starts_at || '未安排'} · {statusLabel(item.status)}</span>
            <h2>{item.title}</h2>
          </header>
          <div className="function-edit-grid">
            <label><span>标题</span><input value={draft.title} onChange={e => setDraft(d => ({ ...d, title: e.target.value }))} /></label>
            <label><span>日期</span><input type="date" value={draft.date} onChange={e => setDraft(d => ({ ...d, date: e.target.value }))} /></label>
            <label><span>开始</span><input type="time" value={draft.starts_at} onChange={e => setDraft(d => ({ ...d, starts_at: e.target.value }))} /></label>
            <label><span>结束</span><input type="time" value={draft.ends_at} onChange={e => setDraft(d => ({ ...d, ends_at: e.target.value }))} /></label>
            <label className="is-wide"><span>备注</span><textarea value={draft.note} onChange={e => setDraft(d => ({ ...d, note: e.target.value }))} rows={3} /></label>
          </div>
          <section className="function-sheet-section">
            <h3>SUBTASKS</h3>
            {(item.subtasks || []).length === 0 && <p className="function-note-box">暂无拆分步骤。</p>}
            {(item.subtasks || []).map(subtask => (
              <button key={subtask.id} className="function-subtask" onClick={() => onToggleSubtask(subtask.id)}>
                <ScheduleCircle done={subtask.done} />
                <span>{subtask.title}</span>
              </button>
            ))}
          </section>
        </div>
        <footer className="function-sheet-actions">
          <button onClick={onDelete}><IconTrash size={16} />删除</button>
          <div>
            <button onClick={() => onStatus('pending')}>待办</button>
            <button className="is-primary" onClick={() => onStatus('done')}>完成</button>
            <button className="is-primary" onClick={() => onSave(draft)} disabled={!draft.title.trim()}><IconEdit size={14} />保存</button>
          </div>
        </footer>
      </section>
    </div>
  );
}
