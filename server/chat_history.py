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
        self._lock = threading.Lock()

    def append(
        self,
        role: str,
        text: str,
        source: str = "pwa",
        quoted_ts: str | None = None,
        location: dict[str, Any] | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        rec: dict[str, Any] = {
            "ts": datetime.now(timezone.utc).astimezone().isoformat(timespec="milliseconds"),
            "role": role,
            "text": text,
            "source": source,
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
    ) -> list[dict[str, Any]]:
        if not self.path.exists():
            return []
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
                    if not include_hidden and rec.get("hidden_in_ui"):
                        continue
                    out.append(rec)
        return out[-limit:]

    def tail(self, n: int = 50) -> list[dict[str, Any]]:
        return self.read_since(since_ts=None, limit=n)

    def search(
        self,
        keyword: str | None = None,
        date_prefix: str | None = None,
        role: str | None = None,
        limit: int = 5000,
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
