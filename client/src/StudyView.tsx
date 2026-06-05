import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiGet, apiPost } from './api';
import { IconMenu, IconDatabase, IconSearch, IconBolt, IconFile, IconStar, IconClock } from './Icons';
import { TopBar, IconButton } from './Shell';

interface StudySource {
  id: string;
  title: string;
  topic?: string;
  kind: string;
  url?: string;
  summary?: string;
  completed: boolean;
  chunk_count: number;
  char_count: number;
  created_at?: string;
}

interface StudyHit {
  source_id: string;
  source_title: string;
  chunk_index: number;
  text: string;
  score: number;
}

interface StudyStatus {
  source_count: number;
  chunk_count: number;
  completed_count: number;
  points?: number;
  pending_tasks?: number;
}

interface StudyTask {
  id: string;
  title: string;
  description?: string;
  questions?: string[];
  source_id?: string;
  minutes: number;
  reward: number;
  penalty: number;
  status: 'pending' | 'completed' | 'failed';
  deadline_ts?: number;
}

interface ShopItem {
  id: string;
  name: string;
  desc: string;
  price: number;
  kind: string;
}

interface InventoryItem {
  id: string;
  name: string;
  desc: string;
  kind: string;
  acquired_at?: string;
}

interface StudyGame {
  points: number;
  tasks: StudyTask[];
  inventory: InventoryItem[];
  shop: ShopItem[];
  active_effects: Record<string, unknown>;
}

export default function StudyView({ openSidebar, showToast }: { openSidebar: () => void; showToast?: (m: string, t?: string) => void }) {
  const [sources, setSources] = useState<StudySource[]>([]);
  const [status, setStatus] = useState<StudyStatus>({ source_count: 0, chunk_count: 0, completed_count: 0 });
  const [game, setGame] = useState<StudyGame>({ points: 0, tasks: [], inventory: [], shop: [], active_effects: {} });
  const [busy, setBusy] = useState(false);
  const [selectedId, setSelectedId] = useState('');
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<StudyHit[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});

  const pendingTasks = useMemo(() => game.tasks.filter(t => t.status === 'pending'), [game.tasks]);

  const load = useCallback(async () => {
    try {
      const [src, st, gm] = await Promise.all([apiGet('/study/sources'), apiGet('/study/status'), apiGet('/study/game')]);
      const nextSources = Array.isArray(src.sources) ? src.sources : [];
      setSources(nextSources);
      setStatus({ source_count: st.source_count || 0, chunk_count: st.chunk_count || 0, completed_count: st.completed_count || 0 });
      setGame({
        points: gm.points || 0,
        tasks: Array.isArray(gm.tasks) ? gm.tasks : [],
        inventory: Array.isArray(gm.inventory) ? gm.inventory : [],
        shop: Array.isArray(gm.shop) ? gm.shop : [],
        active_effects: gm.active_effects || {},
      });
      setSelectedId(prev => prev || nextSources[0]?.id || '');
    } catch (e) {
      showToast?.(`学习库读取失败: ${e}`, 'error');
    }
  }, [showToast]);

  useEffect(() => { load(); }, [load]);

  const search = async () => {
    if (!query.trim()) { setHits([]); return; }
    try {
      const params = new URLSearchParams({ q: query, limit: '12' });
      const data = await apiGet(`/study/search?${params.toString()}`);
      setHits(Array.isArray(data.hits) ? data.hits : []);
    } catch (e) {
      showToast?.(`搜索失败: ${e}`, 'error');
    }
  };

  const submitTask = async (task: StudyTask) => {
    const answer = (answers[task.id] || '').trim();
    if (!answer) { showToast?.('先写答案再提交', 'error'); return; }
    try {
      setBusy(true);
      const questions = Array.isArray(task.questions) && task.questions.length
        ? task.questions.map((q, idx) => `${idx + 1}. ${q}`).join('\n')
        : '';
      await apiPost('/study/ask', {
        mode: 'coach',
        source_id: task.source_id || selectedId || undefined,
        question: `我在 Study 面板提交学习任务，请你严格判定是否通过。任务ID: ${task.id}\n任务: ${task.title}\n${task.description ? `任务说明: ${task.description}\n` : ''}${questions ? `题目:\n${questions}\n` : ''}奖励: ${task.reward}\n失败惩罚: ${task.penalty}\n我的答案:\n${answer}\n如果通过或不通过，请使用 task_judge JSON 工具判定。`,
      });
      setAnswers(prev => ({ ...prev, [task.id]: '' }));
      showToast?.('已提交答案，等 Claude 判定', 'success');
    } catch (e) {
      showToast?.(`提交失败: ${e}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  const buyItem = async (item: ShopItem) => {
    try {
      const result = await apiPost('/study/shop/buy', { id: item.id });
      await load();
      showToast?.(result.mystery?.label || `买到 ${item.name}`, 'success');
    } catch (e) {
      showToast?.(`购买失败: ${e}`, 'error');
    }
  };

  const useItem = async (item: InventoryItem) => {
    try {
      await apiPost('/study/shop/use', { id: item.id });
      await load();
      if (item.id === 'hint') {
        await apiPost('/study/ask', { question: '请根据我的学习库给我一个现在最该看的学习提示。', source_id: selectedId || undefined, mode: 'coach' });
      }
      showToast?.(`已使用 ${item.name}`, 'success');
    } catch (e) {
      showToast?.(`使用失败: ${e}`, 'error');
    }
  };

  return (
    <>
      <TopBar left={<IconButton onClick={openSidebar}><IconMenu /></IconButton>} center={<span className="topbar-title">Study</span>} right={<IconDatabase size={20} />} />

      <div className="study-scroll">
        <div className="study-stats">
          <div className="study-stat accent"><span>{game.points}</span><label>积分</label></div>
          <div className="study-stat"><span>{status.source_count}</span><label>资料</label></div>
          <div className="study-stat"><span>{status.chunk_count}</span><label>片段</label></div>
          <div className="study-stat"><span>{pendingTasks.length}</span><label>任务</label></div>
        </div>

        <section className="study-panel">
          <div className="study-panel-head"><IconStar size={18} /><span>积分与道具</span></div>
          <div className="study-effects">
            {Object.keys(game.active_effects || {}).length === 0 && <span>没有生效中的道具</span>}
            {Boolean(game.active_effects.double) && <b>双倍积分</b>}
            {Boolean(game.active_effects.shield) && <b>护盾</b>}
            {Boolean(game.active_effects.skip) && <b>免罚券</b>}
          </div>
          <div className="study-inventory">
            {game.inventory.length === 0 && <span className="study-muted">背包是空的</span>}
            {game.inventory.map((item, idx) => (
              <button key={`${item.id}-${idx}-${item.acquired_at}`} className="study-chip" onClick={() => useItem(item)}>{item.name}</button>
            ))}
          </div>
          <div className="study-shop-grid">
            {game.shop.map(item => (
              <button key={item.id} className="study-shop-item" onClick={() => buyItem(item)} disabled={game.points < item.price}>
                <span>{item.name}</span>
                <small>{item.desc}</small>
                <b>{item.price} 分</b>
              </button>
            ))}
          </div>
        </section>

        <section className="study-panel">
          <div className="study-panel-head"><IconClock size={18} /><span>任务与惩罚</span></div>
          <div className="study-empty">任务由 AI 发布，提交后也由 AI 判定</div>
          {pendingTasks.length === 0 && <div className="study-empty">暂时没有待完成任务，在主聊天里让 Claude 给你发挑战</div>}
          {pendingTasks.map(task => (
            <div className="study-task" key={task.id}>
              <div className="study-task-body">
                <div className="study-task-title">{task.title}</div>
                <div className="study-source-meta">+{task.reward} / {task.penalty} · {task.minutes} 分钟</div>
                {task.description && <div className="study-task-desc">{task.description}</div>}
                {Array.isArray(task.questions) && task.questions.length > 0 && (
                  <ol className="study-question-list">
                    {task.questions.map((q, idx) => <li key={`${task.id}-q-${idx}`}>{q}</li>)}
                  </ol>
                )}
                <textarea
                  className="study-textarea study-answer"
                  value={answers[task.id] || ''}
                  onChange={e => setAnswers(prev => ({ ...prev, [task.id]: e.target.value }))}
                  placeholder={task.questions?.length ? '在这里作答' : '写下完成说明或答案'}
                  rows={4}
                />
              </div>
              <div className="study-task-actions">
                <button className="study-primary compact" onClick={() => submitTask(task)} disabled={busy || !(answers[task.id] || '').trim()}>提交</button>
              </div>
            </div>
          ))}
        </section>

        <section className="study-panel">
          <div className="study-panel-head"><IconSearch size={18} /><span>搜索知识库</span></div>
          <div className="study-search-row">
            <input className="study-input" value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') search(); }} placeholder="搜索资料片段" />
            <button className="study-icon-action" onClick={search} aria-label="Search"><IconSearch size={18} /></button>
          </div>
          {hits.map(hit => (
            <div className="study-hit" key={`${hit.source_id}-${hit.chunk_index}`}>
              <div className="study-hit-title">{hit.source_title} · #{hit.chunk_index + 1}</div>
              <div className="study-hit-text">{hit.text}</div>
            </div>
          ))}
        </section>

        <section className="study-panel">
          <div className="study-panel-head"><IconFile size={18} /><span>资料列表</span></div>
          {sources.length === 0 && <div className="study-empty">还没有资料</div>}
          {sources.map(source => (
            <div className={`study-source${source.completed ? ' done' : ''}${selectedId === source.id ? ' selected' : ''}`} key={source.id}>
              <button className="study-source-main" onClick={() => setSelectedId(source.id)}>
                <div className="study-source-title">{source.title}</div>
                <div className="study-source-meta">{source.kind} · {source.chunk_count} 片段 · {source.char_count} 字</div>
                {source.summary && <div className="study-source-summary">{source.summary}</div>}
              </button>
            </div>
          ))}
        </section>

        <div className="study-bottom-note"><IconBolt size={14} />聊天页也会自动检索这些资料</div>
      </div>
    </>
  );
}
