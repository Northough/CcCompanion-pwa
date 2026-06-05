"""Study knowledge store with SQLite FTS5 sources and local game state."""
from __future__ import annotations

import html
import json
import re
import threading
import urllib.request
import random
import sqlite3
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from typing import Any


class _TextHTMLParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self._skip = 0
        self.parts: list[str] = []

    def handle_starttag(self, tag: str, attrs):
        if tag in {"script", "style", "noscript", "svg"}:
            self._skip += 1
        if tag in {"p", "div", "section", "article", "br", "li", "h1", "h2", "h3", "h4"}:
            self.parts.append("\n")

    def handle_endtag(self, tag: str):
        if tag in {"script", "style", "noscript", "svg"} and self._skip:
            self._skip -= 1
        if tag in {"p", "div", "section", "article", "li", "h1", "h2", "h3", "h4"}:
            self.parts.append("\n")

    def handle_data(self, data: str):
        if self._skip:
            return
        text = html.unescape(data).strip()
        if text:
            self.parts.append(text)

    def text(self) -> str:
        return clean_text(" ".join(self.parts))


def now_iso() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="milliseconds")


def clean_text(text: str) -> str:
    text = html.unescape(text or "")
    text = text.replace("\r", "\n")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n\s*\n\s*\n+", "\n\n", text)
    return text.strip()


def fetch_url_text(url: str, timeout: int = 12) -> tuple[str, str]:
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "CcCompanionStudy/1.0 (+local learning assistant)",
            "Accept": "text/html,text/plain,application/xhtml+xml",
        },
    )
    with urllib.request.urlopen(req, timeout=timeout) as res:
        raw = res.read(2_500_000)
        content_type = res.headers.get("Content-Type", "")
    charset = "utf-8"
    match = re.search(r"charset=([^;\s]+)", content_type, re.I)
    if match:
        charset = match.group(1).strip("\"'")
    decoded = raw.decode(charset, errors="replace")
    title = ""
    title_match = re.search(r"<title[^>]*>(.*?)</title>", decoded, re.I | re.S)
    if title_match:
        title = clean_text(re.sub(r"<[^>]+>", "", title_match.group(1)))[:160]
    if "html" in content_type.lower() or "<html" in decoded[:500].lower():
        parser = _TextHTMLParser()
        parser.feed(decoded)
        return parser.text(), title
    return clean_text(decoded), title


def chunk_text(text: str, size: int = 900, overlap: int = 120) -> list[str]:
    text = clean_text(text)
    if not text:
        return []
    chunks: list[str] = []
    start = 0
    while start < len(text):
        end = min(len(text), start + size)
        window = text[start:end]
        if end < len(text):
            split_at = max(window.rfind("\n\n"), window.rfind("。"), window.rfind("."), window.rfind("\n"))
            if split_at > size * 0.55:
                end = start + split_at + 1
                window = text[start:end]
        chunks.append(window.strip())
        if end >= len(text):
            break
        start = max(end - overlap, start + 1)
    return [c for c in chunks if c]


def query_terms(q: str) -> list[str]:
    q = (q or "").lower()
    words = re.findall(r"[a-z0-9_+#.-]{2,}|[\u4e00-\u9fff]{2,}", q)
    if len(q.strip()) >= 2:
        words.append(q.strip())
    seen: set[str] = set()
    out: list[str] = []
    for w in words:
        if w not in seen:
            seen.add(w)
            out.append(w)
    return out


def fts_query(terms: list[str]) -> str:
    safe_terms = []
    for term in terms:
        cleaned = term.replace('"', '""').strip()
        if cleaned:
            safe_terms.append(f'"{cleaned}"')
    return " OR ".join(safe_terms)


def cjk_ngrams(text: str) -> list[str]:
    chars = re.findall(r"[\u4e00-\u9fff]", text or "")
    grams: list[str] = []
    for n in (2, 3):
        for i in range(0, max(0, len(chars) - n + 1)):
            grams.append("".join(chars[i:i + n]))
    return grams[:2000]


def fts_index_text(text: str) -> str:
    grams = cjk_ngrams(text)
    return text if not grams else text + "\n" + " ".join(grams)


SHOP_ITEMS = [
    {
        "id": "hint",
        "name": "AI提示",
        "desc": "让 Claude Code 围绕当前资料给一个学习提示",
        "price": 15,
        "kind": "assist",
    },
    {
        "id": "double",
        "name": "双倍积分",
        "desc": "下一个完成的任务奖励翻倍",
        "price": 40,
        "kind": "boost",
    },
    {
        "id": "shield",
        "name": "护盾卡",
        "desc": "抵消下一次任务失败惩罚",
        "price": 35,
        "kind": "protect",
    },
    {
        "id": "skip",
        "name": "免罚券",
        "desc": "删除一个任务且不扣分",
        "price": 25,
        "kind": "task",
    },
    {
        "id": "mystery",
        "name": "神秘盲盒",
        "desc": "随机获得积分或道具，也可能被小小惩罚",
        "price": 30,
        "kind": "mystery",
    },
]


def default_game_state() -> dict[str, Any]:
    return {
        "points": 0,
        "tasks": [],
        "inventory": [],
        "history": [],
        "active_effects": {},
        "custom_shop": [],
        "updated_at": now_iso(),
    }


def extract_json_objects(text: str) -> list[dict[str, Any]]:
    objects: list[dict[str, Any]] = []
    candidates: list[str] = []
    for match in re.finditer(r"```(?:json)?\s*([\s\S]*?)```", text, re.I):
        candidates.append(match.group(1).strip())
    depth = 0
    start = -1
    in_str = False
    esc = False
    for idx, ch in enumerate(text):
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
            continue
        if ch == '"':
            in_str = True
        elif ch == "{":
            if depth == 0:
                start = idx
            depth += 1
        elif ch == "}" and depth:
            depth -= 1
            if depth == 0 and start >= 0:
                candidates.append(text[start:idx + 1])
                start = -1
    for raw in candidates:
        try:
            parsed = json.loads(raw)
        except Exception:
            continue
        if isinstance(parsed, dict):
            signature = json.dumps(parsed, ensure_ascii=False, sort_keys=True)
            if signature not in {json.dumps(o, ensure_ascii=False, sort_keys=True) for o in objects}:
                objects.append(parsed)
    return objects


def strip_json_tool_blocks(text: str, objects: list[dict[str, Any]]) -> str:
    text = re.sub(r"```(?:json)?\s*\{[\s\S]*?\"(?:study_tool|task|task_judge|add_points|grant_item|custom_item|complete_source)\"[\s\S]*?\}\s*```", "", text, flags=re.I)
    for obj in objects:
        raw = json.dumps(obj, ensure_ascii=False)
        compact = json.dumps(obj, ensure_ascii=False, separators=(",", ":"))
        text = text.replace(raw, "").replace(compact, "")
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


class StudyStore:
    def __init__(self, data_dir: str | Path):
        self._dir = Path(data_dir)
        self._dir.mkdir(parents=True, exist_ok=True)
        self._legacy_path = self._dir / "study_sources.jsonl"
        self._db_path = self._dir / "study_knowledge.sqlite3"
        self._game_path = self._dir / "study_game.json"
        self._lock = threading.Lock()
        self._game: dict[str, Any] = default_game_state()
        self._next_id = 1
        self._next_task_id = 1
        self._load()

    def _load(self):
        with self._connect() as con:
            self._init_db(con)
            self._migrate_legacy_jsonl(con)
            self._rebuild_fts(con)
            max_id = 0
            for (source_id,) in con.execute("SELECT id FROM sources"):
                match = re.match(r"^src_(\d+)$", str(source_id))
                if match:
                    max_id = max(max_id, int(match.group(1)))
            self._next_id = max_id + 1
        self._load_game()

    def _connect(self) -> sqlite3.Connection:
        con = sqlite3.connect(self._db_path)
        con.row_factory = sqlite3.Row
        return con

    def _init_db(self, con: sqlite3.Connection):
        con.execute("PRAGMA journal_mode=WAL")
        con.execute("""
            CREATE TABLE IF NOT EXISTS sources (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                topic TEXT NOT NULL DEFAULT '',
                kind TEXT NOT NULL DEFAULT 'text',
                url TEXT NOT NULL DEFAULT '',
                text TEXT NOT NULL,
                summary TEXT NOT NULL DEFAULT '',
                completed INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
        """)
        con.execute("""
            CREATE TABLE IF NOT EXISTS source_chunks (
                source_id TEXT NOT NULL,
                chunk_index INTEGER NOT NULL,
                text TEXT NOT NULL,
                PRIMARY KEY (source_id, chunk_index),
                FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE CASCADE
            )
        """)
        con.execute("""
            CREATE VIRTUAL TABLE IF NOT EXISTS source_chunks_fts USING fts5(
                source_id UNINDEXED,
                chunk_index UNINDEXED,
                title,
                topic,
                text,
                tokenize = 'unicode61'
            )
        """)
        con.commit()

    def _rebuild_fts(self, con: sqlite3.Connection):
        con.execute("DELETE FROM source_chunks_fts")
        rows = con.execute("""
            SELECT c.source_id, c.chunk_index, c.text, s.title, s.topic
            FROM source_chunks c
            JOIN sources s ON s.id = c.source_id
            ORDER BY c.source_id, c.chunk_index
        """).fetchall()
        for row in rows:
            con.execute(
                "INSERT INTO source_chunks_fts (source_id, chunk_index, title, topic, text) VALUES (?, ?, ?, ?, ?)",
                (row["source_id"], row["chunk_index"], fts_index_text(row["title"]), fts_index_text(row["topic"]), fts_index_text(row["text"])),
            )
        con.commit()

    def _migrate_legacy_jsonl(self, con: sqlite3.Connection):
        if not self._legacy_path.exists():
            return
        marker = self._dir / "study_sources_jsonl_migrated"
        if marker.exists():
            return
        existing = con.execute("SELECT COUNT(*) FROM sources").fetchone()[0]
        if existing:
            marker.write_text(now_iso(), encoding="utf-8")
            return
        for line in self._legacy_path.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            try:
                rec = json.loads(line)
            except Exception:
                continue
            self._insert_source_record(con, rec)
        con.commit()
        marker.write_text(now_iso(), encoding="utf-8")

    def _load_game(self):
        self._game = default_game_state()
        if self._game_path.exists():
            try:
                loaded = json.loads(self._game_path.read_text(encoding="utf-8"))
                self._game.update(loaded if isinstance(loaded, dict) else {})
            except Exception:
                pass
        max_task = 0
        for task in self._game.get("tasks") or []:
            match = re.match(r"^task_(\d+)$", str(task.get("id", "")))
            if match:
                max_task = max(max_task, int(match.group(1)))
        self._next_task_id = max_task + 1

    def _new_id(self) -> str:
        n = self._next_id
        self._next_id += 1
        return f"src_{n:04d}"

    def _new_task_id(self) -> str:
        n = self._next_task_id
        self._next_task_id += 1
        return f"task_{n:04d}"

    def _insert_source_record(self, con: sqlite3.Connection, rec: dict[str, Any]):
        chunks = rec.get("chunks") or chunk_text(rec.get("text", ""))
        con.execute(
            """
            INSERT OR REPLACE INTO sources
            (id, title, topic, kind, url, text, summary, completed, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                rec.get("id"),
                rec.get("title", "Untitled source"),
                rec.get("topic", ""),
                rec.get("kind", "text"),
                rec.get("url", ""),
                rec.get("text", ""),
                rec.get("summary", (rec.get("text", "") or "")[:320]),
                1 if rec.get("completed") else 0,
                rec.get("created_at") or now_iso(),
                rec.get("updated_at") or rec.get("created_at") or now_iso(),
            ),
        )
        con.execute("DELETE FROM source_chunks WHERE source_id = ?", (rec.get("id"),))
        con.execute("DELETE FROM source_chunks_fts WHERE source_id = ?", (rec.get("id"),))
        for idx, chunk in enumerate(chunks):
            con.execute(
                "INSERT INTO source_chunks (source_id, chunk_index, text) VALUES (?, ?, ?)",
                (rec.get("id"), idx, chunk),
            )
            con.execute(
                "INSERT INTO source_chunks_fts (source_id, chunk_index, title, topic, text) VALUES (?, ?, ?, ?, ?)",
                (rec.get("id"), idx, fts_index_text(rec.get("title", "")), fts_index_text(rec.get("topic", "")), fts_index_text(chunk)),
            )

    def _source_from_row(self, row: sqlite3.Row, chunk_count: int | None = None) -> dict[str, Any]:
        rec = dict(row)
        rec["completed"] = bool(rec.get("completed"))
        if chunk_count is None:
            with self._connect() as con:
                chunk_count = con.execute("SELECT COUNT(*) FROM source_chunks WHERE source_id = ?", (rec["id"],)).fetchone()[0]
        rec["chunk_count"] = chunk_count
        rec["char_count"] = len(rec.get("text") or "")
        return rec

    def _write_game(self):
        self._game["updated_at"] = now_iso()
        tmp = self._game_path.with_suffix(".tmp")
        tmp.write_text(json.dumps(self._game, ensure_ascii=False, indent=2), encoding="utf-8")
        tmp.replace(self._game_path)

    def _add_points_locked(self, amount: int, reason: str, ref: str = "") -> dict[str, Any]:
        self._game["points"] = int(self._game.get("points", 0)) + amount
        rec = {
            "amount": amount,
            "reason": reason,
            "ref": ref,
            "points": self._game["points"],
            "time": now_iso(),
        }
        self._game.setdefault("history", []).insert(0, rec)
        self._game["history"] = self._game["history"][:200]
        return rec

    def status(self) -> dict[str, Any]:
        with self._lock:
            with self._connect() as con:
                source_count = con.execute("SELECT COUNT(*) FROM sources").fetchone()[0]
                chunks = con.execute("SELECT COUNT(*) FROM source_chunks").fetchone()[0]
                completed = con.execute("SELECT COUNT(*) FROM sources WHERE completed = 1").fetchone()[0]
            pending_tasks = sum(1 for t in self._game.get("tasks", []) if t.get("status") == "pending")
            return {
                "ok": True,
                "source_count": source_count,
                "chunk_count": chunks,
                "completed_count": completed,
                "points": int(self._game.get("points", 0)),
                "pending_tasks": pending_tasks,
            }

    def list_sources(self) -> list[dict[str, Any]]:
        with self._lock:
            with self._connect() as con:
                rows = con.execute("""
                    SELECT s.*, COUNT(c.chunk_index) AS chunk_count
                    FROM sources s
                    LEFT JOIN source_chunks c ON c.source_id = s.id
                    GROUP BY s.id
                    ORDER BY s.created_at DESC
                """).fetchall()
                return [self._public_source(self._source_from_row(row, int(row["chunk_count"] or 0))) for row in rows]

    def get(self, source_id: str) -> dict[str, Any] | None:
        with self._lock:
            with self._connect() as con:
                row = con.execute("SELECT * FROM sources WHERE id = ?", (source_id,)).fetchone()
                if row:
                    return self._source_from_row(row)
        return None

    def add_source(
        self,
        *,
        title: str = "",
        text: str = "",
        url: str = "",
        topic: str = "",
        kind: str = "text",
    ) -> dict[str, Any]:
        fetched_title = ""
        if url and not text.strip():
            text, fetched_title = fetch_url_text(url)
            kind = "url"
        text = clean_text(text)
        if not text:
            raise ValueError("text or readable url required")
        title = (title or fetched_title or topic or url or "Untitled source").strip()[:180]
        chunks = chunk_text(text)
        ts = now_iso()
        rec: dict[str, Any] = {
            "id": self._new_id(),
            "title": title,
            "topic": topic.strip(),
            "kind": kind,
            "url": url.strip(),
            "text": text,
            "summary": text[:320],
            "chunks": chunks,
            "completed": False,
            "created_at": ts,
            "updated_at": ts,
        }
        with self._lock:
            with self._connect() as con:
                self._insert_source_record(con, rec)
                con.commit()
        return self._public_source(rec)

    def delete(self, source_id: str) -> bool:
        with self._lock:
            with self._connect() as con:
                con.execute("DELETE FROM source_chunks_fts WHERE source_id = ?", (source_id,))
                con.execute("DELETE FROM source_chunks WHERE source_id = ?", (source_id,))
                cur = con.execute("DELETE FROM sources WHERE id = ?", (source_id,))
                con.commit()
                return cur.rowcount > 0
        return False

    def complete(self, source_id: str, completed: bool = True) -> dict[str, Any] | None:
        with self._lock:
            with self._connect() as con:
                row = con.execute("SELECT * FROM sources WHERE id = ?", (source_id,)).fetchone()
                if not row:
                    return None
                was_completed = bool(row["completed"])
                con.execute(
                    "UPDATE sources SET completed = ?, updated_at = ? WHERE id = ?",
                    (1 if completed else 0, now_iso(), source_id),
                )
                if completed and not was_completed:
                    self._add_points_locked(15, f"完成章节: {row['title']}", source_id)
                    self._write_game()
                con.commit()
                updated = con.execute("SELECT * FROM sources WHERE id = ?", (source_id,)).fetchone()
                return self._public_source(self._source_from_row(updated))
        return None

    def search(self, q: str, limit: int = 8, source_id: str | None = None) -> list[dict[str, Any]]:
        terms = query_terms(q)
        if not terms:
            return []
        with self._lock:
            with self._connect() as con:
                match_query = fts_query(terms)
                if not match_query:
                    return []
                params: list[Any] = [match_query]
                where = "source_chunks_fts MATCH ?"
                if source_id:
                    where += " AND source_chunks_fts.source_id = ?"
                    params.append(source_id)
                params.append(max(1, min(int(limit or 8), 30)))
                try:
                    rows = con.execute(f"""
                        SELECT f.source_id, s.title AS source_title, s.url, f.chunk_index, c.text,
                               bm25(source_chunks_fts) AS rank
                        FROM source_chunks_fts f
                        JOIN source_chunks c ON c.source_id = f.source_id AND c.chunk_index = f.chunk_index
                        JOIN sources s ON s.id = f.source_id
                        WHERE {where}
                        ORDER BY rank
                        LIMIT ?
                    """, params).fetchall()
                except sqlite3.OperationalError:
                    rows = self._fallback_search(con, q, terms, limit, source_id)
                if not rows:
                    rows = self._fallback_search(con, q, terms, limit, source_id)
                return [
                    {
                        "source_id": row["source_id"],
                        "source_title": row["source_title"],
                        "url": row["url"],
                        "chunk_index": int(row["chunk_index"]),
                        "text": row["text"],
                        "score": float(-row["rank"]) if "rank" in row.keys() else float(row["score"]),
                    }
                    for row in rows
                ]

    def _fallback_search(self, con: sqlite3.Connection, q: str, terms: list[str], limit: int, source_id: str | None = None) -> list[dict[str, Any]]:
        params: list[Any] = []
        where = ""
        if source_id:
            where = "WHERE s.id = ?"
            params.append(source_id)
        rows = con.execute(f"""
            SELECT c.source_id, s.title AS source_title, s.url, c.chunk_index, c.text
            FROM source_chunks c
            JOIN sources s ON s.id = c.source_id
            {where}
        """, params).fetchall()
        scored = []
        for row in rows:
            hay = (row["source_title"] + " " + row["text"]).lower()
            score = sum(3 if term == q.lower().strip() and term in hay else 1 for term in terms if term in hay)
            if score:
                item = dict(row)
                item["score"] = score
                scored.append(item)
        scored.sort(key=lambda r: (r["score"], len(r["text"])), reverse=True)
        return scored[:max(1, min(int(limit or 8), 30))]

    def context_for(self, q: str, limit: int = 5, source_id: str | None = None) -> str:
        hits = self.search(q, limit=limit, source_id=source_id)
        if not hits:
            return ""
        lines = ["--- STUDY KNOWLEDGE CONTEXT ---"]
        for hit in hits:
            title = hit.get("source_title") or hit.get("source_id")
            lines.append(f"[{title} #{hit.get('chunk_index', 0) + 1}]\n{hit.get('text', '')[:1200]}")
        lines.append("--- END STUDY KNOWLEDGE ---")
        return "\n\n".join(lines)

    # --- Game state ---

    def game(self) -> dict[str, Any]:
        with self._lock:
            return self._game_public_locked()

    def _game_public_locked(self) -> dict[str, Any]:
        return {
            "ok": True,
            "points": int(self._game.get("points", 0)),
            "tasks": list(self._game.get("tasks") or []),
            "inventory": list(self._game.get("inventory") or []),
            "history": list(self._game.get("history") or [])[:50],
            "active_effects": dict(self._game.get("active_effects") or {}),
            "shop": self._shop_items_locked(),
        }

    def _shop_items_locked(self) -> list[dict[str, Any]]:
        now_ts = datetime.now(timezone.utc).astimezone().timestamp()
        custom = []
        for item in self._game.get("custom_shop") or []:
            if not item.get("expires_ts") or float(item.get("expires_ts", 0)) > now_ts:
                custom.append(item)
        self._game["custom_shop"] = custom
        return SHOP_ITEMS + custom

    def add_task(
        self,
        title: str,
        minutes: int = 30,
        reward: int = 10,
        penalty: int = -5,
        description: str = "",
        questions: list[str] | None = None,
        source_id: str = "",
    ) -> dict[str, Any]:
        title = title.strip()
        if not title:
            raise ValueError("title required")
        minutes = max(1, min(int(minutes or 30), 24 * 60))
        reward = max(1, min(int(reward or 10), 100))
        penalty = min(-1, max(int(penalty or -5), -100))
        clean_questions = [clean_text(str(q))[:500] for q in (questions or []) if clean_text(str(q))]
        created = now_iso()
        deadline_ts = datetime.now(timezone.utc).astimezone().timestamp() + minutes * 60
        task = {
            "id": self._new_task_id(),
            "title": title,
            "description": clean_text(description)[:1200],
            "questions": clean_questions[:12],
            "source_id": source_id.strip(),
            "minutes": minutes,
            "reward": reward,
            "penalty": penalty,
            "status": "pending",
            "created_at": created,
            "deadline_ts": deadline_ts,
        }
        with self._lock:
            self._game.setdefault("tasks", []).insert(0, task)
            self._write_game()
        return task

    def complete_task(self, task_id: str, passed: bool = True, note: str = "") -> dict[str, Any] | None:
        with self._lock:
            for task in self._game.get("tasks") or []:
                if task.get("id") != task_id:
                    continue
                if task.get("status") != "pending":
                    return task
                task["status"] = "completed" if passed else "failed"
                task["completed_at"] = now_iso()
                if note:
                    task["note"] = note
                if passed:
                    amount = int(task.get("reward", 10))
                    effects = self._game.setdefault("active_effects", {})
                    if effects.get("double"):
                        amount *= 2
                        effects.pop("double", None)
                    self._add_points_locked(amount, f"任务完成: {task.get('title', task_id)}", task_id)
                else:
                    effects = self._game.setdefault("active_effects", {})
                    if effects.get("shield"):
                        effects.pop("shield", None)
                        self._add_points_locked(0, f"护盾抵消失败: {task.get('title', task_id)}", task_id)
                    else:
                        self._add_points_locked(int(task.get("penalty", -5)), f"任务失败: {task.get('title', task_id)}", task_id)
                self._write_game()
                return task
        return None

    def delete_task(self, task_id: str, free: bool = False) -> bool:
        with self._lock:
            tasks = self._game.get("tasks") or []
            target = next((t for t in tasks if t.get("id") == task_id), None)
            before = len(tasks)
            self._game["tasks"] = [t for t in tasks if t.get("id") != task_id]
            if len(self._game["tasks"]) >= before:
                return False
            if target and target.get("status") == "pending" and not free:
                self._add_points_locked(int(target.get("penalty", -5)), f"删除任务: {target.get('title', task_id)}", task_id)
            self._write_game()
            return True

    def buy_item(self, item_id: str) -> dict[str, Any]:
        with self._lock:
            item = next((i for i in self._shop_items_locked() if i["id"] == item_id), None)
            if not item:
                raise ValueError("item not found")
            if int(self._game.get("points", 0)) < int(item["price"]):
                raise ValueError("points not enough")
            self._add_points_locked(-int(item["price"]), f"购买道具: {item['name']}", item_id)
            if item_id == "mystery":
                result = self._open_mystery_locked()
                self._write_game()
                return {"item": item, "mystery": result, **self._game_public_locked()}
            inv = {
                "id": item["id"],
                "name": item["name"],
                "desc": item["desc"],
                "kind": item["kind"],
                "acquired_at": now_iso(),
            }
            self._game.setdefault("inventory", []).insert(0, inv)
            self._write_game()
            return {"item": item, "inventory_item": inv, **self._game_public_locked()}

    def use_item(self, item_id: str) -> dict[str, Any]:
        with self._lock:
            inventory = self._game.get("inventory") or []
            idx = next((i for i, item in enumerate(inventory) if item.get("id") == item_id), -1)
            if idx < 0:
                raise ValueError("item not in inventory")
            item = inventory.pop(idx)
            effects = self._game.setdefault("active_effects", {})
            if item_id == "double":
                effects["double"] = True
            elif item_id == "shield":
                effects["shield"] = True
            elif item_id == "skip":
                effects["skip"] = int(effects.get("skip", 0)) + 1
            elif item_id == "hint":
                self._add_points_locked(0, "使用 AI提示", item_id)
            self._write_game()
            return {"used": item, **self._game_public_locked()}

    def add_points(self, amount: int, reason: str, ref: str = "ai") -> dict[str, Any]:
        amount = max(-100, min(100, int(amount)))
        with self._lock:
            rec = self._add_points_locked(amount, reason or "AI调整积分", ref)
            self._write_game()
            return rec

    def grant_item(self, item_id: str, name: str = "", desc: str = "", kind: str = "ai") -> dict[str, Any]:
        base = next((i for i in SHOP_ITEMS if i["id"] == item_id), None)
        inv = {
            "id": item_id or ("custom_" + now_iso()),
            "name": name or (base.get("name") if base else item_id) or "神秘道具",
            "desc": desc or (base.get("desc") if base else ""),
            "kind": kind or (base.get("kind") if base else "ai"),
            "acquired_at": now_iso(),
        }
        with self._lock:
            self._game.setdefault("inventory", []).insert(0, inv)
            self._write_game()
        return inv

    def add_custom_item(self, name: str, desc: str = "", price: int = 30, effect: str = "", minutes: int = 60) -> dict[str, Any]:
        if not name.strip():
            raise ValueError("name required")
        now_ts = datetime.now(timezone.utc).astimezone().timestamp()
        item = {
            "id": f"custom_{int(now_ts * 1000)}",
            "name": name.strip()[:60],
            "desc": (desc or effect or "AI临时上架的道具").strip()[:160],
            "price": max(1, min(int(price or 30), 200)),
            "kind": "custom",
            "effect": effect.strip()[:160],
            "expires_ts": now_ts + max(1, min(int(minutes or 60), 24 * 60)) * 60,
        }
        with self._lock:
            self._game.setdefault("custom_shop", []).insert(0, item)
            self._write_game()
        return item

    def apply_ai_tools(self, text: str) -> dict[str, Any]:
        objects = extract_json_objects(text)
        applied: list[dict[str, Any]] = []
        for obj in objects:
            applied.extend(self._apply_tool_object(obj))
        display = strip_json_tool_blocks(text, objects) if applied else text
        return {"applied": applied, "display_text": display}

    def _apply_tool_object(self, obj: dict[str, Any]) -> list[dict[str, Any]]:
        actions: list[dict[str, Any]] = []
        if isinstance(obj.get("study_tool"), dict):
            payload = obj["study_tool"]
            action = str(payload.get("action", "")).strip()
            if action == "create_task":
                task = self.add_task(
                    payload.get("title", ""),
                    int(payload.get("minutes", 30)),
                    int(payload.get("reward", 10)),
                    int(payload.get("penalty", -5)),
                    payload.get("description", ""),
                    payload.get("questions") if isinstance(payload.get("questions"), list) else None,
                    payload.get("source_id", ""),
                )
                actions.append({"action": action, "task": task})
            elif action == "add_points":
                rec = self.add_points(int(payload.get("amount", 0)), payload.get("reason", "AI调整积分"))
                actions.append({"action": action, "points": rec})
            elif action == "grant_item":
                item = self.grant_item(payload.get("id", ""), payload.get("name", ""), payload.get("desc", ""), payload.get("kind", "ai"))
                actions.append({"action": action, "item": item})
            elif action == "custom_item":
                item = self.add_custom_item(payload.get("name", ""), payload.get("desc", ""), int(payload.get("price", 30)), payload.get("effect", ""), int(payload.get("minutes", 60)))
                actions.append({"action": action, "item": item})
            elif action == "complete_source":
                source = self.complete(payload.get("id", ""), True)
                if source:
                    actions.append({"action": action, "source": source})

        if "task" in obj and isinstance(obj.get("task"), str):
            task = self.add_task(
                obj.get("task", ""),
                int(obj.get("minutes", 30)),
                int(obj.get("reward", 10)),
                int(obj.get("penalty", -5)),
                obj.get("description", ""),
                obj.get("questions") if isinstance(obj.get("questions"), list) else None,
                obj.get("source_id", ""),
            )
            actions.append({"action": "create_task", "task": task})

        if isinstance(obj.get("task_judge"), dict):
            payload = obj["task_judge"]
            task = self.complete_task(payload.get("id", ""), passed=bool(payload.get("passed", True)), note=payload.get("comment", ""))
            if task:
                actions.append({"action": "task_judge", "task": task})

        if "add_points" in obj:
            rec = self.add_points(int(obj.get("add_points", 0)), obj.get("reason", "AI调整积分"))
            actions.append({"action": "add_points", "points": rec})

        if isinstance(obj.get("grant_item"), dict):
            payload = obj["grant_item"]
            item = self.grant_item(payload.get("id", ""), payload.get("name", ""), payload.get("desc", ""), payload.get("kind", "ai"))
            actions.append({"action": "grant_item", "item": item})

        if isinstance(obj.get("custom_item"), dict):
            payload = obj["custom_item"]
            item = self.add_custom_item(payload.get("name", ""), payload.get("desc", ""), int(payload.get("price", 30)), payload.get("effect", ""), int(payload.get("minutes", 60)))
            actions.append({"action": "custom_item", "item": item})

        if "complete_source" in obj:
            source = self.complete(str(obj.get("complete_source", "")), True)
            if source:
                actions.append({"action": "complete_source", "source": source})

        return actions

    def _open_mystery_locked(self) -> dict[str, Any]:
        roll = random.randint(1, 100)
        if roll <= 45:
            points = random.choice([8, 12, 18, 25])
            self._add_points_locked(points, "盲盒奖励积分", "mystery")
            return {"type": "points", "amount": points, "label": f"+{points} 积分"}
        if roll <= 80:
            item = random.choice([i for i in SHOP_ITEMS if i["id"] in {"hint", "double", "shield", "skip"}])
            inv = {
                "id": item["id"],
                "name": item["name"],
                "desc": item["desc"],
                "kind": item["kind"],
                "acquired_at": now_iso(),
            }
            self._game.setdefault("inventory", []).insert(0, inv)
            return {"type": "item", "item": inv, "label": f"获得 {item['name']}"}
        penalty = random.choice([-3, -5, -8])
        self._add_points_locked(penalty, "盲盒小惩罚", "mystery")
        return {"type": "points", "amount": penalty, "label": f"{penalty} 积分"}

    def _public_source(self, rec: dict[str, Any]) -> dict[str, Any]:
        return {
            "id": rec.get("id"),
            "title": rec.get("title"),
            "topic": rec.get("topic", ""),
            "kind": rec.get("kind", "text"),
            "url": rec.get("url", ""),
            "summary": rec.get("summary", ""),
            "completed": bool(rec.get("completed")),
            "chunk_count": int(rec.get("chunk_count", len(rec.get("chunks") or [])) or 0),
            "char_count": len(rec.get("text") or ""),
            "created_at": rec.get("created_at"),
            "updated_at": rec.get("updated_at"),
        }
