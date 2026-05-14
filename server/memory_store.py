"""Local memory store — JSONL-backed memory with search, pending, and injection."""
from __future__ import annotations

import json
import re
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

VALID_TYPES = {"preference", "project", "relation", "state", "instruction"}


class MemoryStore:
    def __init__(self, data_dir: str | Path):
        self._dir = Path(data_dir)
        self._dir.mkdir(parents=True, exist_ok=True)
        self._path = self._dir / "memories.jsonl"
        self._pending_path = self._dir / "memory_pending.jsonl"
        self._lock = threading.Lock()
        self._items: list[dict[str, Any]] = []
        self._pending: list[dict[str, Any]] = []
        self._next_id = 1
        self._load()

    def _load(self):
        self._items = self._read_jsonl(self._path)
        self._pending = self._read_jsonl(self._pending_path)
        max_id = 0
        for item in self._items + self._pending:
            match = re.match(r"^mem_(\d+)$", str(item.get("id", "")))
            if match:
                max_id = max(max_id, int(match.group(1)))
        self._next_id = max_id + 1

    def _read_jsonl(self, path: Path) -> list[dict[str, Any]]:
        if not path.exists():
            return []
        items: list[dict[str, Any]] = []
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                items.append(json.loads(line))
            except Exception:
                continue
        return items

    def _write_jsonl(self, path: Path, items: list[dict[str, Any]]):
        tmp = path.with_suffix(".tmp")
        tmp.write_text("\n".join(json.dumps(i, ensure_ascii=False) for i in items) + "\n" if items else "", encoding="utf-8")
        tmp.replace(path)

    def _append_jsonl(self, path: Path, record: dict[str, Any]):
        with path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(record, ensure_ascii=False) + "\n")

    def _new_id(self) -> str:
        n = self._next_id
        self._next_id += 1
        return f"mem_{n:04d}"

    def _now(self) -> str:
        return datetime.now(timezone.utc).astimezone().isoformat(timespec="milliseconds")

    # --- Status ---

    def status(self) -> dict[str, Any]:
        with self._lock:
            active = sum(1 for i in self._items if i.get("status") == "active")
            return {
                "ok": True,
                "count": len(self._items),
                "active_count": active,
                "pending_count": len(self._pending),
            }

    # --- List ---

    def list_all(self, type_filter: str | None = None) -> list[dict[str, Any]]:
        with self._lock:
            items = list(reversed(self._items))
        if type_filter and type_filter != "all":
            items = [i for i in items if i.get("type") == type_filter]
        return items

    # --- Search (simple keyword match) ---

    def search(self, q: str, limit: int = 50) -> list[dict[str, Any]]:
        if not q.strip():
            return self.list_all()
        needle = q.lower()
        with self._lock:
            items = list(reversed(self._items))
        results: list[dict[str, Any]] = []
        for item in items:
            haystack = ((item.get("content") or "") + " " + (item.get("evidence") or "")).lower()
            if needle in haystack:
                results.append(item)
                if len(results) >= limit:
                    break
        return results

    # --- Create ---

    def create(self, type: str, content: str, evidence: str = "", confidence: float = 1.0) -> dict[str, Any]:
        if type not in VALID_TYPES:
            type = "instruction"
        record: dict[str, Any] = {
            "id": self._new_id(),
            "type": type,
            "content": content,
            "evidence": evidence,
            "confidence": confidence,
            "status": "active",
            "created_at": self._now(),
            "updated_at": self._now(),
        }
        with self._lock:
            self._items.insert(0, record)
            self._append_jsonl(self._path, record)
        return record

    # --- Expire / Delete ---

    def expire(self, id: str) -> bool:
        return self._update_status(id, "expired")

    def delete(self, id: str) -> bool:
        with self._lock:
            before = len(self._items)
            self._items = [i for i in self._items if i.get("id") != id]
            if len(self._items) < before:
                self._rewrite_main()
                return True
        return False

    def _update_status(self, id: str, status: str) -> bool:
        with self._lock:
            for item in self._items:
                if item.get("id") == id:
                    item["status"] = status
                    item["updated_at"] = self._now()
                    self._rewrite_main()
                    return True
        return False

    def _rewrite_main(self):
        self._write_jsonl(self._path, self._items)

    # --- Pending ---

    def list_pending(self) -> list[dict[str, Any]]:
        with self._lock:
            return list(self._pending)

    def accept_pending(self, id: str) -> dict[str, Any] | None:
        with self._lock:
            target = None
            kept: list[dict[str, Any]] = []
            for p in self._pending:
                if p.get("id") == id:
                    target = p
                else:
                    kept.append(p)
            if target is None:
                return None
            self._pending = kept
            self._write_jsonl(self._pending_path, self._pending)
            target["status"] = "active"
            target["id"] = self._new_id()
            target["updated_at"] = self._now()
            self._items.insert(0, target)
            self._append_jsonl(self._path, target)
            return target

    def reject_pending(self, id: str) -> bool:
        with self._lock:
            before = len(self._pending)
            self._pending = [p for p in self._pending if p.get("id") != id]
            if len(self._pending) < before:
                self._write_jsonl(self._pending_path, self._pending)
                return True
        return False

    def add_pending(self, type: str, content: str, evidence: str = "", confidence: float = 0.5) -> dict[str, Any]:
        record: dict[str, Any] = {
            "id": self._new_id(),
            "type": type,
            "content": content,
            "evidence": evidence,
            "confidence": confidence,
            "status": "pending",
            "created_at": self._now(),
            "updated_at": self._now(),
        }
        with self._lock:
            self._pending.append(record)
            self._append_jsonl(self._pending_path, record)
        return record

    # --- Reindex (no-op for JSONL, just reload) ---

    def reindex(self) -> int:
        with self._lock:
            self._load()
        return len(self._items)

    # --- Injection context ---

    def get_injection_context(self, query: str, top_k: int = 8) -> str:
        """Search memories and return a short injection string for Claude."""
        results = self.search(query, limit=top_k)
        if not results:
            return ""
        lines: list[str] = []
        for r in results:
            if r.get("status") != "active":
                continue
            t = r.get("type", "")
            content = r.get("content", "")
            lines.append(f"[{t}] {content}")
        if not lines:
            return ""
        return "--- MEMORY CONTEXT ---\n" + "\n".join(lines) + "\n--- END MEMORY ---"
