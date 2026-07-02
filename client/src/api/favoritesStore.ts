// Local, persisted favorites — pure frontend so saved content survives backend
// outages and works fully offline. Single message → type 'text' (1 ref);
// multiple messages → type 'collection' (WeChat-style merged favorite).
export interface FavRef {
  ts?: string;
  role?: string;
  text?: string;
}

export interface Favorite {
  id: string;
  type: 'text' | 'collection';
  refs: FavRef[];
  created_at: string;
}

const KEY = 'cc_favorites_v1';

function load(): Favorite[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

let items: Favorite[] = load();
const listeners = new Set<(items: Favorite[]) => void>();

function persist() {
  localStorage.setItem(KEY, JSON.stringify(items));
}

function emit() {
  const snapshot = [...items];
  listeners.forEach(listener => listener(snapshot));
}

export function addFavorite(refs: FavRef[]): Favorite | null {
  if (!refs.length) return null;
  const fav: Favorite = {
    id: `fav_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`,
    type: refs.length >= 2 ? 'collection' : 'text',
    refs: refs.map(r => ({ ts: r.ts, role: r.role, text: r.text })),
    created_at: new Date().toISOString(),
  };
  items = [fav, ...items];
  persist();
  emit();
  return fav;
}

export function removeFavorite(id: string) {
  items = items.filter(item => item.id !== id);
  persist();
  emit();
}

export function subscribeFavorites(cb: (items: Favorite[]) => void) {
  listeners.add(cb);
  cb([...items]);
  return () => {
    listeners.delete(cb);
  };
}
