import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { IconCheck, IconClock, IconClose, IconRefresh } from '../Icons';
import { completeCommand, startCommand, subscribeCommands, type CommandItem } from '../api/commandTransport';
import './CommandFloatWindow.css';

const CANCEL_HOLD_MS = 900;
const SWIPE_COMPLETE_PX = -72;
const SWIPE_COLLAPSE_PX = 72;
// Auto-end a command left unresolved this long past its deadline (or past start, if no countdown).
const AUTO_END_OVERDUE_MS = 60 * 60 * 1000;

export type CommandOutcome = 'completed' | 'canceled' | 'timeout';

function formatDuration(ms: number) {
  const absoluteMs = Math.abs(ms);
  const totalSeconds = Math.floor(absoluteMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${ms < 0 ? '+' : ''}${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function formatStartTime(value: number | null) {
  if (!value) return '';
  const date = new Date(Number(value));
  if (Number.isNaN(date.getTime())) return '';
  return `${date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })} 起`;
}

function getRemainingMs(command: CommandItem | null, nowMs: number) {
  if (!command?.started_at || !command.countdown_seconds) return 0;
  return command.started_at + command.countdown_seconds * 1000 - nowMs;
}

function getElapsedMs(command: CommandItem | null, nowMs: number) {
  if (!command?.started_at) return 0;
  return Math.max(0, nowMs - command.started_at);
}

export default function CommandFloatWindow({ showToast, onResolved }: {
  showToast?: (message: string, tone?: string) => void;
  onResolved?: (command: CommandItem, outcome: CommandOutcome) => void;
}) {
  const [queue, setQueue] = useState<CommandItem[]>([]);
  const [activeId, setActiveId] = useState<string>('');
  const [expanded, setExpanded] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [cancelProgress, setCancelProgress] = useState(0);
  const cancelStartRef = useRef(0);
  const swipeStartRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    return subscribeCommands((commands) => {
      setQueue(commands);
    });
  }, []);

  const activeCommand = useMemo(() => {
    if (!queue.length) return null;
    return queue.find(command => String(command.id) === activeId) || queue[0];
  }, [activeId, queue]);

  useEffect(() => {
    if (!activeCommand) {
      setActiveId('');
      setExpanded(false);
      return;
    }
    setActiveId(String(activeCommand.id));
    if (!activeCommand.started_at) {
      startCommand(activeCommand.id).then((started) => {
        if (!started) return;
        setQueue(current => current.map(command => String(command.id) === String(started.id) ? started : command));
      }).catch(() => {
        showToast?.('指令启动失败', 'error');
      });
    }
  }, [activeCommand, showToast]);

  useEffect(() => {
    let frame = 0;
    const tick = () => {
      setNowMs(Date.now());
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, []);

  const resolve = useCallback(async (command: CommandItem, outcome: CommandOutcome) => {
    const completed = await completeCommand(command.id, outcome);
    if (!completed) {
      showToast?.('指令提交失败', 'error');
      return;
    }
    setQueue(current => current.filter(item => String(item.id) !== String(command.id)));
    setExpanded(false);
    setCancelProgress(0);
    onResolved?.(completed, outcome);
  }, [onResolved, showToast]);

  // Auto-end if left unresolved 60 min past the deadline (or past start, for timing-only tasks).
  useEffect(() => {
    if (!activeCommand?.started_at) return;
    const deadline = activeCommand.countdown_seconds
      ? activeCommand.started_at + activeCommand.countdown_seconds * 1000
      : activeCommand.started_at;
    const autoEndAt = deadline + AUTO_END_OVERDUE_MS;
    const check = () => { if (Date.now() >= autoEndAt) void resolve(activeCommand, 'timeout'); };
    check();
    const timer = window.setInterval(check, 30000);
    return () => window.clearInterval(timer);
  }, [activeCommand, resolve]);

  if (!activeCommand) return null;

  const hasCountdown = Boolean(activeCommand.countdown_seconds);
  const remainingMs = getRemainingMs(activeCommand, nowMs);
  const elapsedMs = getElapsedMs(activeCommand, nowMs);
  const overdue = hasCountdown && remainingMs < 0;
  const totalMs = hasCountdown ? (activeCommand.countdown_seconds || 0) * 1000 : Math.max(elapsedMs, 1000);
  const progress = hasCountdown ? Math.max(0, Math.min(1, remainingMs / totalMs)) : Math.min(1, elapsedMs / 60000);
  const timeText = hasCountdown ? formatDuration(remainingMs) : formatDuration(elapsedMs);
  const startTimeText = formatStartTime(activeCommand.started_at);
  const queueCount = queue.length;

  const completeActive = (outcome: 'completed' | 'canceled' = 'completed') => {
    void resolve(activeCommand, outcome);
  };

  const cancelActive = () => {
    void resolve(activeCommand, 'canceled');
  };

  const startCancelHold = () => {
    cancelStartRef.current = Date.now();
    const update = () => {
      if (!cancelStartRef.current) return;
      const nextProgress = Math.min(1, (Date.now() - cancelStartRef.current) / CANCEL_HOLD_MS);
      setCancelProgress(nextProgress);
      if (nextProgress >= 1) {
        cancelStartRef.current = 0;
        cancelActive();
        return;
      }
      window.requestAnimationFrame(update);
    };
    window.requestAnimationFrame(update);
  };

  const stopCancelHold = () => {
    cancelStartRef.current = 0;
    setCancelProgress(0);
  };

  const handlePointerDown = (event: PointerEvent<HTMLElement>) => {
    swipeStartRef.current = { x: event.clientX, y: event.clientY };
  };

  const handlePointerUp = (event: PointerEvent<HTMLElement>) => {
    const start = swipeStartRef.current;
    swipeStartRef.current = null;
    if (!start) return;
    const dx = event.clientX - start.x;
    const dy = Math.abs(event.clientY - start.y);
    if (dx <= SWIPE_COMPLETE_PX && dy < 48) {
      void completeActive('completed');
      return;
    }
    if (dx >= SWIPE_COLLAPSE_PX && dy < 48) {
      setExpanded(false);
    }
  };

  if (!expanded) {
    return (
      <button
        className={`command-float-rail${overdue ? ' is-overdue' : ''}`}
        type="button"
        onClick={() => setExpanded(true)}
        aria-label="打开指令浮窗"
      >
        <span className="command-rail-icon" aria-hidden="true">
          <IconClock size={14} />
        </span>
        <span className="command-rail-time">{timeText}</span>
        {queueCount > 1 && <span className="command-rail-count">{queueCount}</span>}
      </button>
    );
  }

  return (
    <section
      className={`command-float-card${overdue ? ' is-overdue' : ''}`}
      aria-label="指令浮窗"
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerCancel={() => {
        swipeStartRef.current = null;
      }}
    >
      <header className="command-float-header">
        <span className="command-float-icon" aria-hidden="true">
          <IconRefresh size={16} />
        </span>
        <div className="command-float-title">
          <strong>{activeCommand.title}</strong>
          <small>{startTimeText || '正在计时'}</small>
        </div>
        {queueCount > 1 && <em>{queueCount} 条</em>}
        <button
          className="command-collapse-button"
          type="button"
          onClick={() => setExpanded(false)}
          aria-label="收起指令浮窗"
        >
          <IconClose size={14} />
        </button>
      </header>

      <div className="command-float-time-wrap">
        <div className="command-float-time">{timeText}</div>
        {hasCountdown ? (
          <small className="command-float-subtitle">倒计时任务</small>
        ) : (
          <small className="command-float-subtitle">计时任务</small>
        )}
      </div>

      <div className="command-float-progress" aria-hidden="true">
        <i style={{ transform: `scaleX(${progress})` }} />
      </div>

      <div className="command-float-actions">
        <button
          className="command-cancel-button"
          type="button"
          onPointerDown={startCancelHold}
          onPointerUp={stopCancelHold}
          onPointerLeave={stopCancelHold}
          onPointerCancel={stopCancelHold}
          style={{ '--cancel-progress': String(cancelProgress) } as CSSProperties}
        >
          <span className="command-action-ring" aria-hidden="true" />
          <span>取消</span>
        </button>
        <button className="command-complete-button" type="button" onClick={() => void completeActive('completed')}>
          <IconCheck size={14} />
          <span>完成</span>
        </button>
      </div>
    </section>
  );
}
