"""Chat history store — append-only JSONL."""
from __future__ import annotations

import json
import logging
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

logger = logging.getLogger("cc-server.chat_history")


class ChatHistory:
    def __init__(self, path: str | Path):
        self.path = Path(path).expanduser()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.sessions_path = self.path.with_name("chat_sessions.json")
        self._lock = threading.Lock()

    @staticmethod
    def default_conversation_id() -> str:
        return "cc"

    def _normalize_conversation_id(self, conversation_id: str | None) -> str:
        return (conversation_id or self.default_conversation_id()).strip() or self.default_conversation_id()

    def _load_sessions_unlocked(self) -> dict[str, dict[str, Any]]:
        if not self.sessions_path.exists():
            return {}
        try:
            raw = json.loads(self.sessions_path.read_text(encoding="utf-8"))
            if isinstance(raw, dict):
                return {str(k): v for k, v in raw.items() if isinstance(v, dict)}
        except Exception:
            pass
        return {}

    def _save_sessions_unlocked(self, sessions: dict[str, dict[str, Any]]) -> None:
        tmp = self.sessions_path.with_suffix(self.sessions_path.suffix + ".tmp")
        tmp.write_text(json.dumps(sessions, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        tmp.replace(self.sessions_path)

    def ensure_conversation(self, conversation_id: str | None, title: str | None = None, tmux_session: str | None = None) -> dict[str, Any]:
        conv_id = self._normalize_conversation_id(conversation_id)
        now = datetime.now(timezone.utc).astimezone().isoformat(timespec="milliseconds")
        with self._lock:
            sessions = self._load_sessions_unlocked()
            rec = sessions.get(conv_id) or {
                "id": conv_id,
                "title": title or ("Current chat" if conv_id == self.default_conversation_id() else conv_id),
                "created_at": now,
                "updated_at": now,
                "tmux_session": tmux_session or conv_id,
            }
            if title and (not rec.get("title") or rec.get("title") in {conv_id, "New chat", "Current chat"}):
                rec["title"] = title
            if tmux_session:
                rec["tmux_session"] = tmux_session
            rec["updated_at"] = rec.get("updated_at") or now
            sessions[conv_id] = rec
            self._save_sessions_unlocked(sessions)
            return dict(rec)

    def list_conversations(self, active_id: str | None = None, limit: int = 100) -> list[dict[str, Any]]:
        active = self._normalize_conversation_id(active_id)
        sessions = self._load_sessions_unlocked()
        counts: dict[str, int] = {}
        latest_text: dict[str, str] = {}
        latest_ts: dict[str, str] = {}
        first_user: dict[str, str] = {}
        if self.path.exists():
            with self._lock:
                with self.path.open("r", encoding="utf-8") as f:
                    for line in f:
                        line = line.strip()
                        if not line:
                            continue
                        try:
                            rec = json.loads(line)
                        except Exception:
                            continue
                        if rec.get("hidden_in_ui"):
                            continue
                        conv_id = self._normalize_conversation_id(rec.get("conversation_id"))
                        counts[conv_id] = counts.get(conv_id, 0) + 1
                        text = rec.get("text", "") or ""
                        if text:
                            latest_text[conv_id] = text[:96]
                            latest_ts[conv_id] = rec.get("ts", "")
                            if rec.get("role") == "user" and conv_id not in first_user:
                                first_user[conv_id] = text[:40]

        for conv_id in set(counts) | set(sessions) | {active}:
            now = latest_ts.get(conv_id) or sessions.get(conv_id, {}).get("updated_at") or ""
            stored_title = sessions.get(conv_id, {}).get("title")
            if stored_title in {None, "", conv_id, "New chat", "Current chat"}:
                title = first_user.get(conv_id) or ("Current chat" if conv_id == self.default_conversation_id() else conv_id)
            else:
                title = stored_title
            sessions[conv_id] = {
                "id": conv_id,
                "title": title,
                "created_at": sessions.get(conv_id, {}).get("created_at") or now,
                "updated_at": now,
                "tmux_session": sessions.get(conv_id, {}).get("tmux_session") or conv_id,
                "message_count": counts.get(conv_id, 0),
                "preview": latest_text.get(conv_id, ""),
                "active": conv_id == active,
            }
        return sorted(sessions.values(), key=lambda r: r.get("updated_at") or r.get("created_at") or "", reverse=True)[:limit]

    def delete_conversation(self, conversation_id: str | None) -> dict[str, Any]:
        conv_id = self._normalize_conversation_id(conversation_id)
        deleted_records = 0
        deleted_metadata = False
        with self._lock:
            sessions = self._load_sessions_unlocked()
            deleted_metadata = conv_id in sessions
            sessions.pop(conv_id, None)

            if self.path.exists():
                lines = self.path.read_text(encoding="utf-8").splitlines()
                kept: list[str] = []
                for line in lines:
                    stripped = line.strip()
                    if not stripped:
                        continue
                    try:
                        rec = json.loads(stripped)
                    except Exception:
                        kept.append(line)
                        continue
                    if self._normalize_conversation_id(rec.get("conversation_id")) == conv_id:
                        deleted_records += 1
                        continue
                    kept.append(line)
                self.path.write_text("\n".join(kept) + ("\n" if kept else ""), encoding="utf-8")

            self._save_sessions_unlocked(sessions)
        return {
            "conversation_id": conv_id,
            "deleted_records": deleted_records,
            "deleted_metadata": deleted_metadata,
        }

    def append(
        self,
        role: str,
        text: str,
        source: str = "pwa",
        quoted_ts: str | None = None,
        location: dict[str, Any] | None = None,
        metadata: dict[str, Any] | None = None,
        conversation_id: str | None = None,
    ) -> dict[str, Any]:
        conv_id = self._normalize_conversation_id(conversation_id)
        rec: dict[str, Any] = {
            "ts": datetime.now(timezone.utc).astimezone().isoformat(timespec="milliseconds"),
            "role": role,
            "text": text,
            "source": source,
            "conversation_id": conv_id,
        }
        if quoted_ts:
            rec["quoted_ts"] = quoted_ts
            quoted_text = self._lookup_text(quoted_ts)
            if quoted_text is not None:
                rec["quoted_text"] = quoted_text[:120]
        if location:
            rec["location"] = location
        if metadata:
            rec["metadata"] = metadata
        with self._lock:
            with self.path.open("a", encoding="utf-8") as f:
                f.write(json.dumps(rec, ensure_ascii=False) + "\n")
            sessions = self._load_sessions_unlocked()
            now = rec["ts"]
            meta = sessions.get(conv_id) or {
                "id": conv_id,
                "title": "Current chat" if conv_id == self.default_conversation_id() else conv_id,
                "created_at": now,
                "tmux_session": conv_id,
            }
            if role == "user" and text and meta.get("title") in {conv_id, "New chat", "Current chat"}:
                meta["title"] = text.strip().splitlines()[0][:42]
            meta["updated_at"] = now
            sessions[conv_id] = meta
            self._save_sessions_unlocked(sessions)
        return rec

    def _lookup_text(self, ts: str) -> str | None:
        if not self.path.exists():
            return None
        with self.path.open("r", encoding="utf-8") as f:
            for line in f:
                try:
                    rec = json.loads(line.strip())
                except Exception:
                    continue
                if rec.get("ts") == ts:
                    return rec.get("text", "")
        return None

    def read_since(
        self,
        since_ts: str | None = None,
        before_ts: str | None = None,
        limit: int = 10000,
        include_hidden: bool = False,
        conversation_id: str | None = None,
    ) -> list[dict[str, Any]]:
        if not self.path.exists():
            return []
        conv_id = self._normalize_conversation_id(conversation_id)
        out: list[dict[str, Any]] = []
        with self._lock:
            with self.path.open("r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        rec = json.loads(line)
                    except Exception:
                        continue
                    ts = rec.get("ts", "")
                    if since_ts and ts <= since_ts:
                        continue
                    if before_ts and ts >= before_ts:
                        continue
                    if self._normalize_conversation_id(rec.get("conversation_id")) != conv_id:
                        continue
                    if not include_hidden and rec.get("hidden_in_ui"):
                        continue
                    rec.setdefault("conversation_id", conv_id)
                    out.append(rec)
        return out[-limit:]

    def tail(self, n: int = 50, conversation_id: str | None = None) -> list[dict[str, Any]]:
        return self.read_since(since_ts=None, limit=n, conversation_id=conversation_id)

    def search(
        self,
        keyword: str | None = None,
        date_prefix: str | None = None,
        role: str | None = None,
        limit: int = 5000,
        conversation_id: str | None = None,
    ) -> list[dict[str, Any]]:
        if not self.path.exists():
            return []
        keyword_lower = keyword.lower() if keyword else None
        out: list[dict[str, Any]] = []
        with self._lock:
            with self.path.open("r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        rec = json.loads(line)
                    except Exception:
                        continue
                    if date_prefix and not rec.get("ts", "").startswith(date_prefix):
                        continue
                    if role and rec.get("role") != role:
                        continue
                    if conversation_id and self._normalize_conversation_id(rec.get("conversation_id")) != self._normalize_conversation_id(conversation_id):
                        continue
                    if keyword_lower:
                        text = (rec.get("text", "") or "").lower()
                        if keyword_lower not in text:
                            continue
                    out.append(rec)
        return list(reversed(out[-limit:]))

    def delete(self, ts: str) -> bool:
        if not self.path.exists():
            return False
        deleted = False
        with self._lock:
            lines = self.path.read_text(encoding="utf-8").splitlines()
            kept: list[str] = []
            for line in lines:
                stripped = line.strip()
                if not stripped:
                    continue
                try:
                    rec = json.loads(stripped)
                except Exception:
                    kept.append(line)
                    continue
                if rec.get("ts") == ts and not deleted:
                    deleted = True
                    continue
                kept.append(line)
            if deleted:
                tmp = self.path.with_suffix(self.path.suffix + ".tmp")
                tmp.write_text("\n".join(kept) + "\n", encoding="utf-8")
                tmp.replace(self.path)
        return deleted

    def add_reaction(self, ts: str, emoji: str) -> bool:
        if not self.path.exists():
            return False
        toggled = False
        with self._lock:
            lines = self.path.read_text(encoding="utf-8").splitlines()
            kept: list[str] = []
            for line in lines:
                stripped = line.strip()
                if not stripped:
                    continue
                try:
                    rec = json.loads(stripped)
                except Exception:
                    kept.append(line)
                    continue
                if rec.get("ts") == ts:
                    reactions: list[str] = rec.get("reactions") or []
                    if emoji in reactions:
                        reactions.remove(emoji)
                    else:
                        reactions.append(emoji)
                    if reactions:
                        rec["reactions"] = reactions
                    elif "reactions" in rec:
                        del rec["reactions"]
                    kept.append(json.dumps(rec, ensure_ascii=False))
                    toggled = True
                else:
                    kept.append(line)
            if toggled:
                tmp = self.path.with_suffix(self.path.suffix + ".tmp")
                tmp.write_text("\n".join(kept) + "\n", encoding="utf-8")
                tmp.replace(self.path)
        return toggled

    def mark_regenerated(self, old_ts: str, new_ts: str | None = None) -> bool:
        if not self.path.exists() or not old_ts:
            return False
        marked = False
        with self._lock:
            lines = self.path.read_text(encoding="utf-8").splitlines()
            new_lines: list[str] = []
            for line in lines:
                stripped = line.strip()
                if not stripped:
                    continue
                try:
                    rec = json.loads(stripped)
                except Exception:
                    new_lines.append(line)
                    continue
                if rec.get("ts") == old_ts and not marked:
                    rec["hidden_in_ui"] = True
                    if new_ts:
                        rec["regenerated_to"] = new_ts
                    marked = True
                    new_lines.append(json.dumps(rec, ensure_ascii=False))
                else:
                    new_lines.append(line)
            if marked:
                tmp = self.path.with_suffix(self.path.suffix + ".tmp")
                tmp.write_text("\n".join(new_lines) + "\n", encoding="utf-8")
                tmp.replace(self.path)
        return marked
