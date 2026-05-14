"""Favorites store backed by JSONL."""
from __future__ import annotations

import json
import logging
import re
import threading
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any

logger = logging.getLogger("cc-server.favorites")

VALID_TYPES = {"text", "image", "link", "collection"}


class Favorites:
    def __init__(self, jsonl_path: str | Path | None = None, vault_path: str | Path | None = None):
        self.jsonl_path = Path(jsonl_path).expanduser().resolve() if jsonl_path is not None else Path("data/favorites.jsonl").resolve()
        self.vault_path = Path(vault_path).expanduser().resolve() if vault_path is not None else Path("data/favorites_vault").resolve()
        self._lock = threading.Lock()
        self.jsonl_path.parent.mkdir(parents=True, exist_ok=True)
        self.jsonl_path.touch(exist_ok=True)
        self.vault_path.mkdir(parents=True, exist_ok=True)
        self._items: list[dict[str, Any]] = []
        self._next_id_n = 1
        self.reload()

    def add(self, type: str, source: str, refs: list[dict[str, Any]], tags: list[str] | None = None, note: str | None = None) -> dict[str, Any]:
        self._validate(type, refs)
        refs_copy = [dict(ref) for ref in refs]
        record = {
            "id": self._next_id(),
            "created_at": datetime.now().astimezone().isoformat(timespec="milliseconds"),
            "type": type,
            "source": source,
            "refs": refs_copy,
            "tags": [str(tag) for tag in (tags or [])],
        }
        if note is not None:
            record["note"] = note
        with self._lock:
            with self.jsonl_path.open("a", encoding="utf-8") as f:
                f.write(json.dumps(record, ensure_ascii=False) + "\n")
            self._items.append(record)
        return record

    def list(self, type: str | None = None, tag: str | None = None, q: str | None = None, limit: int = 50, offset: int = 0) -> list[dict[str, Any]]:
        with self._lock:
            items = list(reversed(self._items))
        if type:
            items = [i for i in items if i.get("type") == type]
        if tag:
            items = [i for i in items if tag in (i.get("tags") or [])]
        if q:
            needle = q.lower()
            items = [i for i in items if needle in self._haystack(i)]
        return items[max(offset, 0):max(offset, 0) + max(limit, 0)]

    def get(self, id: str) -> dict[str, Any] | None:
        with self._lock:
            for item in self._items:
                if item.get("id") == id:
                    return dict(item)
        return None

    def edit(self, id: str, tags: list[str] | None = None, note: str | None = None) -> dict[str, Any] | None:
        with self._lock:
            for idx, item in enumerate(self._items):
                if item.get("id") != id:
                    continue
                updated = dict(item)
                if tags is not None:
                    updated["tags"] = [str(t) for t in tags]
                if note is not None:
                    updated["note"] = note
                self._items[idx] = updated
                self._rewrite_jsonl()
                return updated
        return None

    def delete(self, id: str) -> bool:
        with self._lock:
            target = None
            kept = []
            for item in self._items:
                if item.get("id") == id:
                    target = item
                else:
                    kept.append(item)
            if target is None:
                return False
            self._items = kept
            self._rewrite_jsonl()
            return True

    def reload(self) -> int:
        items: list[dict[str, Any]] = []
        max_id = 0
        if self.jsonl_path.exists():
            with self.jsonl_path.open("r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        item = json.loads(line)
                    except Exception:
                        continue
                    if isinstance(item, dict):
                        items.append(item)
                        match = re.match(r"^fav_(\d+)$", str(item.get("id", "")))
                        if match:
                            max_id = max(max_id, int(match.group(1)))
        with self._lock:
            self._items = items
            self._next_id_n = max_id + 1
        return len(items)

    def _validate(self, type: str, refs: list[dict[str, Any]]) -> None:
        if type not in VALID_TYPES:
            raise ValueError("type must be text, image, link, or collection")
        if not refs:
            raise ValueError("refs required")
        if type == "collection" and len(refs) < 2:
            raise ValueError("collection requires at least 2 refs")

    def _next_id(self) -> str:
        n = self._next_id_n
        self._next_id_n += 1
        width = 3 if n < 1000 else len(str(n))
        return f"fav_{n:0{width}d}"

    def _rewrite_jsonl(self) -> None:
        tmp = self.jsonl_path.with_suffix(self.jsonl_path.suffix + ".tmp")
        with tmp.open("w", encoding="utf-8") as f:
            for item in self._items:
                f.write(json.dumps(item, ensure_ascii=False) + "\n")
        tmp.replace(self.jsonl_path)

    def _haystack(self, item: dict[str, Any]) -> str:
        parts = [str(item.get("note") or "")]
        for ref in item.get("refs") or []:
            parts.extend(str(ref.get(key) or "") for key in ("text", "title", "url"))
        return "\n".join(parts).lower()
