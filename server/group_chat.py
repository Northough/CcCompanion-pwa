"""Group chat store — append-only JSONL messages + JSON state.

Data is stored in the same data_dir used by the rest of the server:
  - group_messages.jsonl   (append-only message log)
  - group_state.json       (roster, online map, typing map)

Roster can be overridden by ``server/agents_config.json`` (see
``agents_config.example.json`` for the schema).
"""
from __future__ import annotations

import json
import logging
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
import uuid

logger = logging.getLogger("cc-server.group_chat")

# ── Default roster ──────────────────────────────────────────────────────
DEFAULT_ROSTER: list[dict[str, Any]] = [
    {"id": "user", "name": "User", "display_name": "User", "kind": "human", "color": "#D94683", "can_reply": False},
    {"id": "assistant", "name": "Assistant", "display_name": "Assistant", "kind": "agent", "color": "#E779A8", "model": "Claude", "can_reply": True, "default_responder": True},
    {"id": "coder", "name": "Coder", "display_name": "Coder", "kind": "agent", "color": "#8B6FD1", "model": "Claude", "can_reply": True},
    {"id": "reviewer", "name": "Reviewer", "display_name": "Reviewer", "kind": "agent", "color": "#4C9A78", "model": "Codex", "can_reply": True},
]

_AGENTS_CONFIG_NAME = "agents_config.json"


def _normalize_member(member: dict[str, Any]) -> dict[str, Any]:
    out = dict(member)
    name = out.get("name") or out.get("display_name") or out.get("id")
    out["name"] = name
    out["display_name"] = out.get("display_name") or name
    out.setdefault("kind", "agent" if out.get("can_reply") else "human")
    out.setdefault("color", "#888888")
    return out


def _load_roster(data_dir: Path) -> list[dict[str, Any]]:
    """Try loading roster from agents_config.json; fall back to defaults."""
    cfg_path = data_dir.parent / _AGENTS_CONFIG_NAME
    if cfg_path.exists():
        try:
            raw = json.loads(cfg_path.read_text(encoding="utf-8"))
            roster = raw.get("roster") or raw.get("agents")
            if isinstance(roster, list) and roster:
                return [_normalize_member(m) for m in roster if isinstance(m, dict) and m.get("id")]
        except Exception as exc:
            logger.warning("Failed to load %s: %s", cfg_path, exc)
    return [dict(m) for m in DEFAULT_ROSTER]


def _apply_member_overrides(roster: list[dict[str, Any]], overrides: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    allowed = {"name", "display_name", "color"}
    out: list[dict[str, Any]] = []
    for member in roster:
        merged = dict(member)
        patch = overrides.get(str(member.get("id"))) or {}
        for key in allowed:
            value = patch.get(key)
            if isinstance(value, str) and value.strip():
                merged[key] = value.strip()
        out.append(_normalize_member(merged))
    return out


class GroupChatStore:
    """Append-only group chat message bus with roster + presence."""

    def __init__(self, data_dir: Path):
        self._data_dir = Path(data_dir)
        self._data_dir.mkdir(parents=True, exist_ok=True)
        self._msg_path = self._data_dir / "group_messages.jsonl"
        self._state_path = self._data_dir / "group_state.json"

        self._lock = threading.Lock()

        # Load or initialise state
        self._state: dict[str, Any] = self._load_state()
        self._state.setdefault("member_overrides", {})
        self._state["roster"] = _apply_member_overrides(_load_roster(self._data_dir), self._state["member_overrides"])
        self._state.setdefault("online", {})       # sender_id -> last heartbeat iso
        self._state.setdefault("typing", {})        # sender_id -> last typing iso
        self._save_state()

    # ── State persistence ──────────────────────────────────────────────

    def _load_state(self) -> dict[str, Any]:
        if self._state_path.exists():
            try:
                return json.loads(self._state_path.read_text(encoding="utf-8"))
            except Exception:
                pass
        return {}

    def _save_state(self) -> None:
        try:
            self._state_path.write_text(
                json.dumps(self._state, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
        except Exception as exc:
            logger.warning("group_state save failed: %s", exc)

    # ── Roster ─────────────────────────────────────────────────────────

    def get_roster(self) -> list[dict[str, Any]]:
        with self._lock:
            return [dict(m) for m in self._state.get("roster", DEFAULT_ROSTER)]

    def get_member(self, member_id: str) -> dict[str, Any] | None:
        with self._lock:
            for member in self._state.get("roster", DEFAULT_ROSTER):
                if member.get("id") == member_id:
                    return dict(member)
        return None

    def refresh_roster(self) -> list[dict[str, Any]]:
        """Re-read agents_config.json and update roster in memory."""
        with self._lock:
            self._state["roster"] = _apply_member_overrides(
                _load_roster(self._data_dir),
                self._state.setdefault("member_overrides", {}),
            )
            self._save_state()
            return [dict(m) for m in self._state["roster"]]

    def update_member(self, member_id: str, patch: dict[str, Any]) -> dict[str, Any]:
        member_id = (member_id or "").strip()
        if not member_id:
            raise ValueError("member_id required")
        allowed = {"name", "display_name", "color"}
        clean: dict[str, str] = {}
        for key in allowed:
            value = patch.get(key)
            if isinstance(value, str) and value.strip():
                clean[key] = value.strip()[:40] if key != "color" else value.strip()[:16]
        with self._lock:
            roster = self._state.get("roster", DEFAULT_ROSTER)
            if not any(m.get("id") == member_id for m in roster):
                raise KeyError(member_id)
            overrides = self._state.setdefault("member_overrides", {})
            current = dict(overrides.get(member_id) or {})
            current.update(clean)
            overrides[member_id] = current
            self._state["roster"] = _apply_member_overrides(_load_roster(self._data_dir), overrides)
            self._save_state()
            for member in self._state["roster"]:
                if member.get("id") == member_id:
                    return dict(member)
        raise KeyError(member_id)

    # ── Presence / typing ──────────────────────────────────────────────

    def heartbeat(self, sender_id: str) -> None:
        now = _now_iso()
        with self._lock:
            self._state.setdefault("online", {})[sender_id] = now
            # Remove typing when heartbeat arrives
            self._state.setdefault("typing", {}).pop(sender_id, None)
            self._save_state()

    def set_typing(self, sender_id: str, typing: bool = True) -> None:
        now = _now_iso()
        with self._lock:
            if typing:
                self._state.setdefault("typing", {})[sender_id] = now
            else:
                self._state.setdefault("typing", {}).pop(sender_id, None)
            self._save_state()

    def get_presence(self) -> dict[str, Any]:
        with self._lock:
            return {
                "online": dict(self._state.get("online", {})),
                "typing": dict(self._state.get("typing", {})),
            }

    # ── Agent bridge cursors ───────────────────────────────────────────

    def latest_ts(self) -> str | None:
        latest = None
        if not self._msg_path.exists():
            return latest
        with self._lock:
            with self._msg_path.open("r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        rec = json.loads(line)
                    except Exception:
                        continue
                    latest = rec.get("ts") or latest
        return latest

    def get_agent_offset(self, agent_id: str) -> str | None:
        with self._lock:
            return self._state.setdefault("agent_offsets", {}).get(agent_id)

    def set_agent_offset(self, agent_id: str, ts: str) -> None:
        if not agent_id or not ts:
            return
        with self._lock:
            self._state.setdefault("agent_offsets", {})[agent_id] = ts
            self._save_state()

    def agent_offsets(self) -> dict[str, str]:
        with self._lock:
            return dict(self._state.setdefault("agent_offsets", {}))

    # ── Messages ───────────────────────────────────────────────────────

    def send(
        self,
        sender_id: str,
        text: str,
        *,
        mentions: list[str] | None = None,
        message_type: str = "chat",
        task_id: str | None = None,
        delivery_targets: list[str] | None = None,
    ) -> dict[str, Any]:
        rec: dict[str, Any] = {
            "id": f"grp_{int(datetime.now().timestamp() * 1000)}_{uuid.uuid4().hex[:8]}",
            "ts": _now_iso(),
            "conversation_id": "workgroup",
            "sender_id": sender_id,
            "text": text,
            "message_type": message_type,
            "delivery": {
                "targets": delivery_targets or mentions or [],
                "mode": "mention" if mentions else "broadcast",
            },
        }
        if mentions:
            rec["mentions"] = mentions
        if task_id:
            rec["task_id"] = task_id
        if delivery_targets:
            rec["delivery_targets"] = delivery_targets

        with self._lock:
            with self._msg_path.open("a", encoding="utf-8") as f:
                f.write(json.dumps(rec, ensure_ascii=False) + "\n")

            # Clear typing for sender
            self._state.setdefault("typing", {}).pop(sender_id, None)
            self._save_state()

        logger.info("group msg %s from %s (%d chars)", rec["ts"], sender_id, len(text))
        return rec

    def poll(
        self,
        *,
        since_ts: str | None = None,
        limit: int = 200,
    ) -> list[dict[str, Any]]:
        """Return messages after *since_ts*."""
        records: list[dict[str, Any]] = []
        if not self._msg_path.exists():
            return records

        with self._lock:
            with self._msg_path.open("r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        rec = json.loads(line)
                    except Exception:
                        continue
                    if since_ts and rec.get("ts", "") <= since_ts:
                        continue
                    records.append(rec)
                    if since_ts and len(records) >= limit:
                        break
        return records if since_ts else records[-limit:]

    def agent_inbox(
        self,
        agent_id: str,
        *,
        since_ts: str | None = None,
        limit: int = 50,
        include_broadcast: bool = True,
    ) -> list[dict[str, Any]]:
        """Return messages targeted at *agent_id* after *since_ts*."""
        member = self.get_member(agent_id)
        if not member:
            return []

        records: list[dict[str, Any]] = []
        for rec in self.poll(since_ts=since_ts, limit=5000):
            if self._targets_agent(rec, member, include_broadcast=include_broadcast):
                records.append(rec)
                if len(records) >= limit:
                    break
        return records

    @staticmethod
    def _targets_agent(rec: dict[str, Any], member: dict[str, Any], *, include_broadcast: bool = True) -> bool:
        agent_id = member.get("id")
        if not agent_id or rec.get("sender_id") == agent_id:
            return False
        if rec.get("message_type") == "system":
            return False

        explicit_targets: set[str] = set()
        for key in ("mentions", "delivery_targets"):
            val = rec.get(key)
            if isinstance(val, list):
                explicit_targets.update(str(x) for x in val)
        delivery = rec.get("delivery")
        if isinstance(delivery, dict):
            targets = delivery.get("targets")
            if isinstance(targets, list):
                explicit_targets.update(str(x) for x in targets)

        if explicit_targets:
            return agent_id in explicit_targets

        if not include_broadcast:
            return False

        # Unmentioned user messages go only to the default responder. Agent
        # messages must explicitly mention another agent to avoid reply loops.
        return rec.get("sender_id") == "user" and bool(member.get("default_responder"))


def _now_iso() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="microseconds")
