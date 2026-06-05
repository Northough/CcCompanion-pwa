"""Linux-compatible CcCompanion server — core endpoints only."""
from __future__ import annotations

import argparse
import json
import logging
import os
import subprocess
import sys
import threading
import time
try:
    import tomllib
except ModuleNotFoundError:
    try:
        import tomli as tomllib
    except ModuleNotFoundError:
        tomllib = None  # fallback to simple parser
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import urlparse, parse_qs

from chat_history import ChatHistory
from favorites import Favorites
from settings import Settings
from usage import UsageReader
from memory_store import MemoryStore
from group_chat import GroupChatStore
from study_store import StudyStore

HERE = Path(__file__).resolve().parent
DEFAULT_CONFIG = HERE / "config.toml"

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger("cc-server")


def _parse_simple_toml(path: Path) -> dict[str, Any]:
    """Minimal TOML parser for config.toml — handles [sections] and key = value."""
    config: dict[str, Any] = {}
    current_section = config
    section_name = ""
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("[") and line.endswith("]"):
            section_name = line[1:-1]
            config[section_name] = {}
            current_section = config[section_name]
            continue
        if "=" in line:
            key, _, val = line.partition("=")
            key = key.strip()
            val = val.strip()
            # Remove comments after value
            if "#" in val:
                val = val[:val.index("#")].strip()
            # Remove quotes
            if (val.startswith('"') and val.endswith('"')) or (val.startswith("'") and val.endswith("'")):
                val = val[1:-1]
            elif val.lower() in ("true", "false"):
                val = val.lower() == "true"
            else:
                try:
                    val = int(val)
                except ValueError:
                    try:
                        val = float(val)
                    except ValueError:
                        pass
            current_section[key] = val
    return config


def _load_or_create_secret() -> str:
    secret_file = HERE / ".secret"
    try:
        if secret_file.exists():
            s = secret_file.read_text().strip()
            if s:
                return s
        import secrets as _secrets
        new_secret = _secrets.token_hex(32)
        secret_file.write_text(new_secret)
        secret_file.chmod(0o600)
        logger.info("Auto-generated shared_secret saved to %s", secret_file)
        return new_secret
    except Exception as e:
        logger.warning("Could not auto-generate secret: %s", e)
        return ""


class ServerState:
    def __init__(self, config: dict[str, Any]):
        server_cfg = config.get("server", {})
        self.host: str = server_cfg.get("host", "0.0.0.0")
        self.port: int = int(server_cfg.get("port", 8795))

        raw_secret = server_cfg.get("shared_secret") or ""
        if not raw_secret:
            raw_secret = _load_or_create_secret()
        self.shared_secret: str | None = raw_secret or None
        self.strict_auth: bool = bool(server_cfg.get("strict_auth", True))

        data_dir = Path(server_cfg.get("data_dir", str(HERE / "data")))
        data_dir.mkdir(parents=True, exist_ok=True)

        self.chat = ChatHistory(data_dir / "chat_history.jsonl")
        self.favorites = Favorites(
            jsonl_path=data_dir / "favorites.jsonl",
            vault_path=data_dir / "favorites_vault",
        )
        self.settings = Settings(data_dir / "settings.json")
        self.usage = UsageReader(data_dir=data_dir)
        self.memory = MemoryStore(data_dir)
        self.study = StudyStore(data_dir)

        self.attachments_dir = data_dir / "attachments"
        self.attachments_dir.mkdir(parents=True, exist_ok=True)

        self.group = GroupChatStore(data_dir)

        tmux_cfg = config.get("tmux", {})
        self.default_session: str = tmux_cfg.get("session", "cc")
        self.bus_hook_path: str = tmux_cfg.get("bus_hook_path", "")

        self.active_session: str = self.default_session
        self.typing_state: dict[str, Any] = {"is_typing": False, "since": None}

    @classmethod
    def from_config(cls, config_path: str | Path) -> "ServerState":
        p = Path(config_path)
        if p.exists():
            if tomllib is not None:
                with open(p, "rb") as f:
                    config = tomllib.load(f)
            else:
                config = _parse_simple_toml(p)
        else:
            config = {}
        return cls(config)


class RequestHandler(BaseHTTPRequestHandler):
    state: ServerState

    server_version = "CcServer-Linux/1.0"

    def log_message(self, format, *args):
        logger.info("%s %s", self.address_string(), format % args)

    def _read_body(self) -> dict[str, Any]:
        length = int(self.headers.get("Content-Length", 0))
        if not length:
            return {}
        raw = self.rfile.read(length)
        return json.loads(raw)

    def _check_auth(self) -> bool:
        if not self.state.shared_secret:
            return True
        token = self.headers.get("X-Auth-Token", "") or self.headers.get("X-Auth", "")
        return token == self.state.shared_secret

    def _require_auth(self) -> bool:
        if self._check_auth():
            return True
        if not self.state.strict_auth:
            ip = self.client_address[0] if self.client_address else "unknown"
            logger.warning("unauthenticated request allowed strict_auth=false ip=%s path=%s", ip, self.path)
            return True
        self._send_json(403, {"error": "auth required"})
        return False

    def _send_json(self, status: int, body: dict[str, Any]):
        data = json.dumps(body, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Auth-Token, X-Auth")
        self.end_headers()
        self.wfile.write(data)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Auth-Token, X-Auth")
        self.end_headers()

    # ---- GET routes ----

    def do_GET(self):
        path = urlparse(self.path).path

        if path == "/health":
            self._send_json(200, {"ok": True, "version": "1.0"})
            return

        # All endpoints below require auth
        if not self._require_auth():
            return

        if path.startswith("/chat/history"):
            self._handle_chat_history()
            return
        if path.startswith("/chat/search"):
            self._handle_chat_search()
            return
        if path == "/chat/status":
            self._send_json(200, {"ok": True, **self.state.typing_state})
            return

        if path.startswith("/tmux/capture"):
            self._handle_tmux_capture()
            return
        if path == "/tmux/sessions":
            self._handle_tmux_sessions()
            return
        if path == "/chain/sessions":
            self._handle_chain_sessions()
            return

        if path.startswith("/favorites/list"):
            self._handle_favorites_list()
            return
        if path.startswith("/favorites/get"):
            self._handle_favorites_get()
            return

        if path.startswith("/attachments/"):
            self._handle_attachment_get()
            return

        if path == "/settings":
            self._send_json(200, {"ok": True, "settings": self.state.settings.snapshot()})
            return

        if path == "/usage/active":
            self._handle_usage_active()
            return

        if path == "/diag":
            self._handle_diag()
            return

        if path == "/memory/status":
            self._send_json(200, self._memory_status())
            return
        if path == "/memory/list":
            self._handle_memory_list()
            return
        if path.startswith("/memory/search"):
            self._handle_memory_search()
            return
        if path == "/memory/pending":
            self._send_json(200, {"ok": True, "pending": self.state.memory.list_pending()})
            return

        if path == "/study/status":
            self._send_json(200, self.state.study.status())
            return
        if path == "/study/game":
            self._send_json(200, self.state.study.game())
            return
        if path == "/study/sources":
            self._send_json(200, {"ok": True, "sources": self.state.study.list_sources()})
            return
        if path.startswith("/study/search"):
            self._handle_study_search()
            return

        # ── Group chat GET ──
        if path == "/group/roster":
            self._handle_group_roster()
            return
        if path.startswith("/group/poll"):
            self._handle_group_poll()
            return

        self._send_json(404, {"error": "not found"})

    # ---- POST routes ----

    def do_POST(self):
        # /chat/upload uses multipart; auth is checked inside the handler
        if urlparse(self.path).path == "/chat/upload":
            if self._require_auth():
                self._handle_chat_upload()
            return

        if not self._require_auth():
            return
        path = urlparse(self.path).path
        body = self._read_body()

        if path == "/chat/send":
            self._handle_chat_send(body)
        elif path == "/chat/append":
            self._handle_chat_append(body)
        elif path == "/chat/delete":
            self._handle_chat_delete(body)
        elif path == "/chat/react":
            self._handle_chat_react(body)
        elif path == "/chat/regenerate":
            self._handle_chat_regenerate(body)
        elif path == "/tmux/send":
            self._handle_tmux_send(body)
        elif path == "/favorites/add":
            self._handle_favorites_add(body)
        elif path == "/favorites/edit":
            self._handle_favorites_edit(body)
        elif path == "/favorites/delete":
            self._handle_favorites_delete(body)
        elif path == "/settings":
            self._handle_settings_post(body)
        elif path == "/chain/sessions":
            self._handle_chain_sessions()
        elif path == "/chain/new_session":
            self._handle_chain_new_session(body)
        elif path == "/chain/switch":
            self._handle_chain_switch(body)
        elif path == "/chain/abort":
            self._handle_chain_abort(body)
        elif path == "/memory/create":
            self._handle_memory_create(body)
        elif path == "/memory/expire":
            self._handle_memory_expire(body)
        elif path == "/memory/delete":
            self._handle_memory_delete(body)
        elif path == "/memory/pending/accept":
            self._handle_memory_pending_accept(body)
        elif path == "/memory/pending/reject":
            self._handle_memory_pending_reject(body)
        elif path == "/memory/reindex":
            n = self.state.memory.reindex()
            self._send_json(200, {"ok": True, "indexed": n})
        elif path == "/study/sources/add":
            self._handle_study_source_add(body)
        elif path == "/study/sources/delete":
            self._handle_study_source_delete(body)
        elif path == "/study/sources/complete":
            self._handle_study_source_complete(body)
        elif path == "/study/ask":
            self._handle_study_ask(body)
        elif path == "/study/tasks/add":
            self._handle_study_task_add(body)
        elif path == "/study/tasks/complete":
            self._handle_study_task_complete(body)
        elif path == "/study/tasks/delete":
            self._handle_study_task_delete(body)
        elif path == "/study/shop/buy":
            self._handle_study_shop_buy(body)
        elif path == "/study/shop/use":
            self._handle_study_shop_use(body)
        # ── Group chat POST ──
        elif path == "/group/send":
            self._handle_group_send(body)
        elif path == "/group/typing":
            self._handle_group_typing(body)
        elif path == "/group/roster_heartbeat":
            self._handle_group_heartbeat(body)
        else:
            self._send_json(404, {"error": "not found"})

    # ---- Chat handlers ----

    def _study_tool_prompt(self) -> str:
        try:
            game = self.state.study.game()
            sources = self.state.study.list_sources()[:12]
        except Exception:
            game = {"points": 0, "tasks": [], "shop": []}
            sources = []
        pending = [t for t in game.get("tasks", []) if t.get("status") == "pending"][:10]
        lines = [
            "--- STUDY TOOL PROTOCOL ---",
            "你可以用隐藏 JSON 工具控制学习系统。工具 JSON 会被 CcCompanion 执行并从聊天显示中隐藏。",
            "只有在你真的要创建任务、判作业、加减分、发道具、上架限时道具或完成资料时才输出工具 JSON。",
            "请把工具 JSON 放在独立的 ```json 代码块里；自然语言回复照常写在代码块外。",
            f"当前积分: {game.get('points', 0)}",
            "待完成任务: " + ("; ".join(f"{t.get('id')}={t.get('title')}" for t in pending) if pending else "无"),
            "商店道具ID: " + ", ".join(i.get("id", "") for i in game.get("shop", [])),
            "资料ID: " + ("; ".join(f"{s.get('id')}={s.get('title')}" for s in sources) if sources else "无"),
            "可用格式示例:",
            '{"study_tool":{"action":"create_task","title":"HTML 表单小测","description":"回答后在 Study 页面提交","questions":["label 的 for 属性有什么用？","button 默认 type 是什么？"],"source_id":"src_0001","minutes":30,"reward":10,"penalty":-5}}',
            '{"task_judge":{"id":"task_0001","passed":true,"score":10,"comment":"完成得很好"}}',
            '{"add_points":5,"reason":"主动复习奖励"}',
            '{"grant_item":{"id":"double","name":"双倍积分","desc":"下个任务双倍"}}',
            '{"custom_item":{"name":"限时亲亲券","desc":"完成下一题后兑现","price":20,"effect":"鼓励","minutes":60}}',
            '{"complete_source":"src_0001"}',
            "--- END STUDY TOOL PROTOCOL ---",
        ]
        return "\n".join(lines)

    def _handle_chat_send(self, body: dict[str, Any]):
        text = body.get("text", "").strip()
        quoted_ts = body.get("quoted_ts") or None
        location = body.get("location") or None
        if not text and not location:
            self._send_json(400, {"error": "text or location required"})
            return

        rec = self.state.chat.append(
            role="user", text=text, source="pwa", quoted_ts=quoted_ts, location=location,
        )

        ts_prefix = "[" + datetime.now().strftime("%Y-%m-%d %H:%M:%S") + "]"
        injected = f"{ts_prefix} {text}"
        if rec.get("quoted_text"):
            injected = f'{ts_prefix} [引用 "{rec["quoted_text"]}"]\n{text}'

        # Memory injection — prepend context to tmux inject only (not visible in chat)
        injection_enabled = bool(self.state.settings.get("memory_injection_enabled", False))
        if injection_enabled and text:
            top_k = int(self.state.settings.get("memory_top_k", 8))
            mem_ctx = self.state.memory.get_injection_context(text, top_k=top_k)
            if mem_ctx:
                injected = f"{mem_ctx}\n\n{injected}"

        study_ctx = self.state.study.context_for(text, limit=5)
        if study_ctx:
            injected = f"{study_ctx}\n\n{injected}"
        injected = f"{self._study_tool_prompt()}\n\n{injected}"

        self.state.typing_state = {"is_typing": True, "since": rec["ts"]}

        session = self.state.active_session
        try:
            subprocess.Popen(
                ["tmux", "load-buffer", "-"],
                stdin=subprocess.PIPE,
            ).communicate(input=injected.encode("utf-8"))
            subprocess.run(["tmux", "paste-buffer", "-t", session, "-p"], check=False)
            subprocess.run(["tmux", "send-keys", "-t", session, "Enter"], check=False)
            threading.Thread(
                target=self._watch_reply_once,
                args=(session, rec["ts"]),
                daemon=True,
            ).start()
        except Exception as e:
            logger.warning("tmux inject fail: %s", e)

        self._send_json(200, {"ok": True, "record": rec})

    def _inject_to_active_claude(self, text: str, source: str = "pwa", context: str = "") -> dict[str, Any]:
        rec = self.state.chat.append(role="user", text=text, source=source)
        ts_prefix = "[" + datetime.now().strftime("%Y-%m-%d %H:%M:%S") + "]"
        injected = f"{ts_prefix} {text}"
        tool_prompt = self._study_tool_prompt()
        if context:
            injected = f"{tool_prompt}\n\n{context}\n\n{injected}"
        else:
            injected = f"{tool_prompt}\n\n{injected}"
        self.state.typing_state = {"is_typing": True, "since": rec["ts"]}
        session = self.state.active_session
        try:
            subprocess.Popen(
                ["tmux", "load-buffer", "-"],
                stdin=subprocess.PIPE,
            ).communicate(input=injected.encode("utf-8"))
            subprocess.run(["tmux", "paste-buffer", "-t", session, "-p"], check=False)
            subprocess.run(["tmux", "send-keys", "-t", session, "Enter"], check=False)
            threading.Thread(
                target=self._watch_reply_once,
                args=(session, rec["ts"]),
                daemon=True,
            ).start()
        except Exception as e:
            logger.warning("tmux inject fail: %s", e)
        return rec

    def _capture_tmux(self, session: str, lines: int = 40) -> str:
        try:
            result = subprocess.run(
                ["tmux", "capture-pane", "-t", session, "-p", "-S", str(-lines)],
                capture_output=True, text=True, timeout=3,
            )
            return result.stdout if result.returncode == 0 else ""
        except Exception:
            return ""

    @staticmethod
    def _extract_reply_from_capture(content: str) -> str | None:
        lines = content.strip().split("\n")
        if not lines:
            return None

        assistant_prefixes = ("⏺", "●", "•")

        def is_assistant_line(line: str) -> bool:
            stripped = line.strip()
            return any(stripped.startswith(prefix) for prefix in assistant_prefixes)

        def strip_assistant_prefix(line: str) -> str:
            stripped = line.lstrip()
            for prefix in assistant_prefixes:
                if stripped.startswith(prefix):
                    return stripped[len(prefix):].lstrip()
            return line

        marker_idx = -1
        for i, line in enumerate(lines):
            if "✻" in line:
                marker_idx = i
        if marker_idx < 0:
            return None

        start_idx = -1
        for i in range(marker_idx - 1, -1, -1):
            if is_assistant_line(lines[i]):
                start_idx = i
                break
            if lines[i].strip().startswith("❯"):
                break
        if start_idx < 0:
            return None

        reply_lines: list[str] = []
        for i in range(start_idx, marker_idx):
            line = lines[i].rstrip()
            if is_assistant_line(line):
                line = strip_assistant_prefix(line)
            reply_lines.append(line)

        while reply_lines and not reply_lines[0].strip():
            reply_lines.pop(0)
        while reply_lines and not reply_lines[-1].strip():
            reply_lines.pop()

        text = "\n".join(reply_lines).strip()
        return text if len(text) >= 2 else None

    def _watch_reply_once(self, session: str, user_ts: str):
        deadline = time.time() + 180
        last_capture = ""
        stable_count = 0
        while time.time() < deadline:
            time.sleep(2)
            content = self._capture_tmux(session, lines=50)
            if not content:
                continue
            if content == last_capture:
                stable_count += 1
            else:
                stable_count = 0
                last_capture = content
            if stable_count < 2 or "✻" not in content:
                continue
            reply = self._extract_reply_from_capture(content)
            if not reply:
                continue
            recent = self.state.chat.tail(6)
            if any(r.get("role") == "assistant" and r.get("text") == reply for r in recent):
                return
            tool_result = self.state.study.apply_ai_tools(reply)
            display_reply = tool_result.get("display_text") or ("学习状态已更新。" if tool_result.get("applied") else reply)
            self.state.chat.append(
                role="assistant",
                text=display_reply,
                source="claude-code",
                metadata={"study_tools": tool_result.get("applied", [])} if tool_result.get("applied") else None,
            )
            self.state.typing_state = {"is_typing": False, "since": None}
            logger.info("captured assistant reply for %s (%d chars)", user_ts, len(reply))
            return

    def _handle_chat_append(self, body: dict[str, Any]):
        text = body.get("text", "").strip()
        if not text:
            self._send_json(400, {"error": "text required"})
            return
        source = body.get("source", "claude-code")
        tool_result = self.state.study.apply_ai_tools(text) if source in {"claude-code", "study", "assistant"} else {"display_text": text, "applied": []}
        display_text = tool_result.get("display_text") or ("学习状态已更新。" if tool_result.get("applied") else text)
        rec = self.state.chat.append(
            role="assistant",
            text=display_text,
            source=source,
            metadata={"study_tools": tool_result.get("applied", [])} if tool_result.get("applied") else None,
        )
        self.state.typing_state = {"is_typing": False, "since": None}
        self._send_json(200, {"ok": True, "record": rec})

    def _handle_chat_history(self):
        qs = parse_qs(urlparse(self.path).query)
        since = qs.get("since", [None])[0]
        before = qs.get("before", [None])[0]
        try:
            limit = int(qs.get("limit", ["10000"])[0])
        except Exception:
            limit = 10000
        limit = min(max(limit, 1), 10000)

        records = self.state.chat.read_since(since_ts=since, before_ts=before, limit=limit)
        self._send_json(200, {"ok": True, "records": records, "count": len(records)})

    def _handle_chat_search(self):
        qs = parse_qs(urlparse(self.path).query)
        keyword = qs.get("q", [None])[0]
        date_prefix = qs.get("date", [None])[0]
        role = qs.get("role", [None])[0]
        try:
            limit = int(qs.get("limit", ["5000"])[0])
        except Exception:
            limit = 5000
        records = self.state.chat.search(keyword=keyword, date_prefix=date_prefix, role=role, limit=limit)
        self._send_json(200, {"ok": True, "records": records, "count": len(records)})

    def _handle_chat_delete(self, body: dict[str, Any]):
        ts = body.get("ts", "")
        if not ts:
            self._send_json(400, {"error": "ts required"})
            return
        ok = self.state.chat.delete(ts)
        self._send_json(200 if ok else 404, {"ok": ok})

    def _handle_chat_react(self, body: dict[str, Any]):
        ts = body.get("ts", "")
        emoji = body.get("emoji", "")
        if not ts or not emoji:
            self._send_json(400, {"error": "ts and emoji required"})
            return
        ok = self.state.chat.add_reaction(ts, emoji)
        self._send_json(200, {"ok": ok})

    def _handle_chat_regenerate(self, body: dict[str, Any]):
        old_ts = body.get("old_ts", "")
        new_text = body.get("new_text", "")
        if not old_ts:
            self._send_json(400, {"error": "old_ts required"})
            return
        self.state.chat.mark_regenerated(old_ts)
        if new_text:
            rec = self.state.chat.append(role="assistant", text=new_text, source="regenerate")
            self._send_json(200, {"ok": True, "record": rec})
        else:
            self._send_json(200, {"ok": True})

    # ---- tmux handlers ----

    def _handle_tmux_capture(self):
        qs = parse_qs(urlparse(self.path).query)
        session = qs.get("session", [self.state.default_session])[0]
        try:
            lines = int(qs.get("lines", ["120"])[0])
        except Exception:
            lines = 120
        try:
            result = subprocess.run(
                ["tmux", "capture-pane", "-t", session, "-p", "-S", str(-lines)],
                capture_output=True, text=True, timeout=3,
            )
            if result.returncode != 0:
                self._send_json(404, {"error": result.stderr.strip() or "session not found"})
                return
            self._send_json(200, {"ok": True, "session": session, "content": result.stdout})
        except Exception as e:
            self._send_json(500, {"error": str(e)})

    # tmux special keys that should use send-keys, not paste-buffer
    TMUX_SPECIAL_KEYS = frozenset({
        "C-c", "C-d", "C-z", "C-l", "C-a", "C-e", "C-k", "C-u", "C-w",
        "Escape", "Tab", "Backspace", "Delete", "Up", "Down", "Left", "Right",
        "Home", "End", "PageUp", "PageDown", "Insert", "Enter", "Space",
        "BTab", "DC", "IC", "NPage", "PPage", "BS",
    })

    def _handle_tmux_send(self, body: dict[str, Any]):
        keys = body.get("keys", "")
        session = body.get("session") or self.state.active_session or self.state.default_session
        enter = bool(body.get("enter", True))
        if not keys and not enter:
            self._send_json(400, {"error": "keys or enter required"})
            return
        try:
            if keys:
                if keys in self.TMUX_SPECIAL_KEYS:
                    # Special key — use send-keys directly
                    subprocess.run(["tmux", "send-keys", "-t", session, keys], check=False)
                else:
                    # Text — use load-buffer + paste-buffer for safety
                    p = subprocess.Popen(["tmux", "load-buffer", "-"], stdin=subprocess.PIPE)
                    p.communicate(input=keys.encode("utf-8"))
                    subprocess.run(["tmux", "paste-buffer", "-t", session, "-p"], check=False)
            if enter:
                subprocess.run(["tmux", "send-keys", "-t", session, "Enter"], check=False)
            self._send_json(200, {"ok": True, "session": session})
        except Exception as e:
            self._send_json(500, {"error": str(e)})

    def _handle_tmux_sessions(self):
        try:
            result = subprocess.run(
                ["tmux", "list-sessions", "-F", "#{session_name}"],
                capture_output=True, text=True, timeout=3,
            )
            sessions = [s.strip() for s in result.stdout.strip().split("\n") if s.strip()] if result.returncode == 0 else []
            self._send_json(200, {"ok": True, "sessions": sessions})
        except Exception as e:
            self._send_json(500, {"error": str(e)})

    # ---- Favorites handlers ----

    def _handle_favorites_list(self):
        qs = parse_qs(urlparse(self.path).query)
        type_filter = qs.get("type", [None])[0]
        tag = qs.get("tag", [None])[0]
        q = qs.get("q", [None])[0]
        try:
            limit = int(qs.get("limit", ["50"])[0])
        except Exception:
            limit = 50
        try:
            offset = int(qs.get("offset", ["0"])[0])
        except Exception:
            offset = 0
        items = self.state.favorites.list(type=type_filter, tag=tag, q=q, limit=limit, offset=offset)
        self._send_json(200, {"ok": True, "items": items, "count": len(items)})

    def _handle_favorites_get(self):
        qs = parse_qs(urlparse(self.path).query)
        fav_id = qs.get("id", [None])[0]
        if not fav_id:
            self._send_json(400, {"error": "id required"})
            return
        item = self.state.favorites.get(fav_id)
        if item is None:
            self._send_json(404, {"error": "not found"})
            return
        self._send_json(200, {"ok": True, "item": item})

    def _handle_favorites_add(self, body: dict[str, Any]):
        type_ = body.get("type", "text")
        source = body.get("source", "pwa")
        refs = body.get("refs", [])
        tags = body.get("tags")
        note = body.get("note")
        try:
            item = self.state.favorites.add(type=type_, source=source, refs=refs, tags=tags, note=note)
            self._send_json(200, {"ok": True, "item": item})
        except ValueError as e:
            self._send_json(400, {"error": str(e)})

    def _handle_favorites_edit(self, body: dict[str, Any]):
        fav_id = body.get("id", "")
        if not fav_id:
            self._send_json(400, {"error": "id required"})
            return
        item = self.state.favorites.edit(fav_id, tags=body.get("tags"), note=body.get("note"))
        self._send_json(200 if item else 404, {"ok": item is not None, "item": item})

    def _handle_favorites_delete(self, body: dict[str, Any]):
        fav_id = body.get("id", "")
        if not fav_id:
            self._send_json(400, {"error": "id required"})
            return
        ok = self.state.favorites.delete(fav_id)
        self._send_json(200 if ok else 404, {"ok": ok})

    # ---- Settings handler ----

    def _handle_settings_post(self, body: dict[str, Any]):
        key = body.get("key")
        value = body.get("value")
        if key is None or value is None:
            self._send_json(400, {"error": "key and value required"})
            return
        self.state.settings.set(str(key), value)
        self._send_json(200, {"ok": True})

    # ---- Usage handler ----

    def _handle_usage_active(self):
        data = self.state.usage.get_active()
        self._send_json(200, data)

    # ---- Memory handlers ----

    def _memory_status(self) -> dict[str, Any]:
        s = self.state.memory.status()
        s["injection_enabled"] = bool(self.state.settings.get("memory_injection_enabled", False))
        s["top_k"] = int(self.state.settings.get("memory_top_k", 8))
        return s

    def _handle_memory_list(self):
        qs = parse_qs(urlparse(self.path).query)
        type_filter = qs.get("type", [None])[0]
        self._send_json(200, {"ok": True, "memories": self.state.memory.list_all(type_filter)})

    def _handle_memory_search(self):
        qs = parse_qs(urlparse(self.path).query)
        q = qs.get("q", [""])[0]
        self._send_json(200, {"ok": True, "memories": self.state.memory.search(q)})

    def _handle_memory_create(self, body: dict[str, Any]):
        type_ = body.get("type", "instruction")
        content = body.get("content", "").strip()
        if not content:
            self._send_json(400, {"error": "content required"})
            return
        record = self.state.memory.create(
            type=type_, content=content,
            evidence=body.get("evidence", ""),
            confidence=float(body.get("confidence", 1.0)),
        )
        self._send_json(200, {"ok": True, "memory": record})

    def _handle_memory_expire(self, body: dict[str, Any]):
        id = body.get("id", "")
        if not id:
            self._send_json(400, {"error": "id required"})
            return
        ok = self.state.memory.expire(id)
        self._send_json(200 if ok else 404, {"ok": ok})

    def _handle_memory_delete(self, body: dict[str, Any]):
        id = body.get("id", "")
        if not id:
            self._send_json(400, {"error": "id required"})
            return
        ok = self.state.memory.delete(id)
        self._send_json(200 if ok else 404, {"ok": ok})

    def _handle_memory_pending_accept(self, body: dict[str, Any]):
        id = body.get("id", "")
        if not id:
            self._send_json(400, {"error": "id required"})
            return
        result = self.state.memory.accept_pending(id)
        self._send_json(200 if result else 404, {"ok": result is not None, "memory": result})

    def _handle_memory_pending_reject(self, body: dict[str, Any]):
        id = body.get("id", "")
        if not id:
            self._send_json(400, {"error": "id required"})
            return
        ok = self.state.memory.reject_pending(id)
        self._send_json(200 if ok else 404, {"ok": ok})

    # ---- Study handlers ----

    def _handle_study_search(self):
        qs = parse_qs(urlparse(self.path).query)
        q = qs.get("q", [""])[0]
        source_id = qs.get("source_id", [None])[0]
        try:
            limit = int(qs.get("limit", ["8"])[0])
        except Exception:
            limit = 8
        limit = min(max(limit, 1), 30)
        hits = self.state.study.search(q, limit=limit, source_id=source_id)
        self._send_json(200, {"ok": True, "hits": hits, "count": len(hits)})

    def _handle_study_source_add(self, body: dict[str, Any]):
        try:
            source = self.state.study.add_source(
                title=body.get("title", ""),
                text=body.get("text", ""),
                url=body.get("url", ""),
                topic=body.get("topic", ""),
                kind=body.get("kind", "text"),
            )
            self._send_json(200, {"ok": True, "source": source})
        except ValueError as e:
            self._send_json(400, {"error": str(e)})
        except Exception as e:
            logger.warning("study source add failed: %s", e)
            self._send_json(500, {"error": str(e)})

    def _handle_study_source_delete(self, body: dict[str, Any]):
        source_id = body.get("id", "")
        if not source_id:
            self._send_json(400, {"error": "id required"})
            return
        ok = self.state.study.delete(source_id)
        self._send_json(200 if ok else 404, {"ok": ok})

    def _handle_study_source_complete(self, body: dict[str, Any]):
        source_id = body.get("id", "")
        if not source_id:
            self._send_json(400, {"error": "id required"})
            return
        completed = bool(body.get("completed", True))
        source = self.state.study.complete(source_id, completed=completed)
        self._send_json(200 if source else 404, {"ok": source is not None, "source": source})

    def _handle_study_ask(self, body: dict[str, Any]):
        question = body.get("question", "").strip()
        source_id = body.get("source_id") or None
        mode = body.get("mode", "coach")
        if not question:
            self._send_json(400, {"error": "question required"})
            return

        source = self.state.study.get(source_id) if source_id else None
        ctx = self.state.study.context_for(question + " " + (source.get("title", "") if source else ""), limit=6, source_id=source_id)
        system = [
            "--- STUDY COACH MODE ---",
            "你是 CcCompanion 里的学习导师，语气亲密、耐心、直接。",
            "优先依据 STUDY KNOWLEDGE CONTEXT 回答；如果资料不足，明确说资料里没有，并给出下一步学习建议。",
            "回答结构：先给结论，再拆步骤，最后给 1-3 个小练习或检查问题。",
            "不要编造来源，不要要求用户再去设置 API。",
        ]
        if source:
            system.append(f"当前资料: {source.get('title', '')}")
        if mode == "quiz":
            system.append("当前模式是出题：请根据资料出 3 道小测，不要直接给答案，等用户回答后再批改。")
        elif mode == "explain":
            system.append("当前模式是讲解：请用适合初学者的方式解释，并指出最容易误解的点。")
        context = "\n".join(system)
        if ctx:
            context = f"{context}\n\n{ctx}"
        rec = self._inject_to_active_claude(question, source="study", context=context)
        self._send_json(200, {"ok": True, "record": rec, "context_used": bool(ctx)})

    def _handle_study_task_add(self, body: dict[str, Any]):
        try:
            task = self.state.study.add_task(
                body.get("title", ""),
                minutes=int(body.get("minutes", 30) or 30),
                reward=int(body.get("reward", 10) or 10),
                penalty=int(body.get("penalty", -5) or -5),
                description=body.get("description", ""),
                questions=body.get("questions") if isinstance(body.get("questions"), list) else None,
                source_id=body.get("source_id", ""),
            )
            self._send_json(200, {"ok": True, "task": task, "game": self.state.study.game()})
        except ValueError as e:
            self._send_json(400, {"error": str(e)})
        except Exception as e:
            self._send_json(500, {"error": str(e)})

    def _handle_study_task_complete(self, body: dict[str, Any]):
        task_id = body.get("id", "")
        if not task_id:
            self._send_json(400, {"error": "id required"})
            return
        task = self.state.study.complete_task(task_id, passed=bool(body.get("passed", True)), note=body.get("note", ""))
        self._send_json(200 if task else 404, {"ok": task is not None, "task": task, "game": self.state.study.game()})

    def _handle_study_task_delete(self, body: dict[str, Any]):
        task_id = body.get("id", "")
        if not task_id:
            self._send_json(400, {"error": "id required"})
            return
        ok = self.state.study.delete_task(task_id, free=bool(body.get("free", False)))
        self._send_json(200 if ok else 404, {"ok": ok, "game": self.state.study.game()})

    def _handle_study_shop_buy(self, body: dict[str, Any]):
        item_id = body.get("id", "")
        if not item_id:
            self._send_json(400, {"error": "id required"})
            return
        try:
            result = self.state.study.buy_item(item_id)
            self._send_json(200, {"ok": True, **result})
        except ValueError as e:
            self._send_json(400, {"error": str(e)})

    def _handle_study_shop_use(self, body: dict[str, Any]):
        item_id = body.get("id", "")
        if not item_id:
            self._send_json(400, {"error": "id required"})
            return
        try:
            result = self.state.study.use_item(item_id)
            self._send_json(200, {"ok": True, **result})
        except ValueError as e:
            self._send_json(400, {"error": str(e)})

    # ---- Group chat handlers ----

    def _handle_group_roster(self):
        roster = self.state.group.get_roster()
        presence = self.state.group.get_presence()
        self._send_json(200, {"ok": True, "roster": roster, **presence})

    def _handle_group_poll(self):
        qs = parse_qs(urlparse(self.path).query)
        since = qs.get("since", [None])[0]
        try:
            limit = int(qs.get("limit", ["200"])[0])
        except Exception:
            limit = 200
        limit = min(max(limit, 1), 5000)
        viewer_id = qs.get("sender_id", [None])[0]
        if viewer_id:
            self.state.group.heartbeat(viewer_id)
        records = self.state.group.poll(since_ts=since, limit=limit)
        self._send_json(200, {"ok": True, "records": records, "count": len(records)})

    def _handle_group_send(self, body: dict[str, Any]):
        sender_id = body.get("sender_id", "user").strip()
        text = body.get("text", "").strip()
        if not text:
            self._send_json(400, {"error": "text required"})
            return
        mentions = body.get("mentions") or []
        message_type = body.get("message_type", "chat")
        task_id = body.get("task_id") or None
        delivery_targets = body.get("delivery_targets") or None

        rec = self.state.group.send(
            sender_id,
            text,
            mentions=mentions,
            message_type=message_type,
            task_id=task_id,
            delivery_targets=delivery_targets,
        )
        self._send_json(200, {"ok": True, "record": rec})

    def _handle_group_typing(self, body: dict[str, Any]):
        sender_id = body.get("sender_id", "user").strip()
        typing = bool(body.get("typing", True))
        self.state.group.set_typing(sender_id, typing)
        self._send_json(200, {"ok": True})

    def _handle_group_heartbeat(self, body: dict[str, Any]):
        sender_id = body.get("sender_id", "user").strip()
        self.state.group.heartbeat(sender_id)
        self._send_json(200, {"ok": True})

    def _handle_diag(self):
        import time as _time
        diag: dict[str, Any] = {"ok": True}

        # Check tmux sessions
        try:
            result = subprocess.run(
                ["tmux", "list-sessions", "-F", "#{session_name}"],
                capture_output=True, text=True, timeout=3,
            )
            sessions = [s.strip() for s in result.stdout.strip().split("\n") if s.strip()] if result.returncode == 0 else []
            diag["tmux_ok"] = True
            diag["sessions"] = sessions
            diag["active_session"] = self.state.active_session
        except Exception:
            diag["tmux_ok"] = False
            diag["sessions"] = []
            diag["active_session"] = self.state.active_session

        # Check if Claude is running in the active session
        claude_running = False
        try:
            cap = subprocess.run(
                ["tmux", "capture-pane", "-t", self.state.active_session, "-p", "-S", "-5"],
                capture_output=True, text=True, timeout=3,
            )
            if cap.returncode == 0:
                out = cap.stdout
                claude_running = "✻" in out or "Claude" in out or "claude" in out.lower()
        except Exception:
            pass
        diag["claude_running"] = claude_running

        # Check chat history
        try:
            recent = self.state.chat.tail(3)
            diag["history_count"] = len(recent)
            diag["last_message_ts"] = recent[-1]["ts"] if recent else None
        except Exception:
            diag["history_count"] = 0

        # Config
        diag["strict_auth"] = self.state.strict_auth
        diag["port"] = self.state.port

        self._send_json(200, diag)

    # ---- Attachment handler ----

    def _handle_attachment_get(self):
        rel = urlparse(self.path).path[len("/attachments/"):]
        base = self.state.attachments_dir.resolve()
        target = (self.state.attachments_dir / rel).resolve()
        try:
            target.relative_to(base)
        except ValueError:
            self._send_json(403, {"error": "forbidden"})
            return
        if not target.exists() or not target.is_file():
            self._send_json(404, {"error": "not found"})
            return
        data = target.read_bytes()
        self.send_response(200)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    # ---- Chain / session management ----

    def _handle_chain_sessions(self):
        try:
            result = subprocess.run(
                ["tmux", "list-sessions", "-F", "#{session_name}"],
                capture_output=True, text=True, timeout=3,
            )
            sessions = [s.strip() for s in result.stdout.strip().split("\n") if s.strip()] if result.returncode == 0 else []
            self._send_json(200, {"ok": True, "sessions": sessions, "active": self.state.active_session})
        except Exception as e:
            self._send_json(500, {"error": str(e)})

    def _handle_chain_new_session(self, body: dict[str, Any]):
        name = body.get("name", "").strip()
        if not name:
            import random
            name = f"cc-{random.randint(1000, 9999)}"
        try:
            subprocess.run(["tmux", "new-session", "-d", "-s", name], check=True, timeout=5)
            # Launch interactive claude in the new session
            subprocess.run(["tmux", "send-keys", "-t", name, "claude", "Enter"], check=False)
            self.state.active_session = name
            self._send_json(200, {"ok": True, "session": name, "active": name, "launched_claude": True})
        except Exception as e:
            self._send_json(500, {"error": str(e)})

    def _handle_chain_switch(self, body: dict[str, Any]):
        session = body.get("session", "").strip()
        if not session:
            self._send_json(400, {"error": "session required"})
            return
        try:
            result = subprocess.run(
                ["tmux", "has-session", "-t", session],
                capture_output=True, timeout=3,
            )
            if result.returncode != 0:
                self._send_json(404, {"error": f"session '{session}' not found"})
                return
            self.state.active_session = session
            self._send_json(200, {"ok": True, "active": session})
        except Exception as e:
            self._send_json(500, {"error": str(e)})

    def _handle_chain_abort(self, body: dict[str, Any]):
        session = body.get("session") or self.state.active_session
        try:
            subprocess.run(["tmux", "send-keys", "-t", session, "C-c"], check=False)
            self._send_json(200, {"ok": True, "session": session})
        except Exception as e:
            self._send_json(500, {"error": str(e)})

    # ---- Upload handler ----

    def _handle_chat_upload(self):
        content_type = self.headers.get("Content-Type", "")
        if "multipart/form-data" not in content_type:
            self._send_json(400, {"error": "multipart/form-data required"})
            return

        content_length = int(self.headers.get("Content-Length", 0))
        if content_length > 50 * 1024 * 1024:
            self._send_json(413, {"error": "file too large (max 50MB)"})
            return

        body = self.rfile.read(content_length)
        boundary = content_type.split("boundary=")[1].strip()
        if boundary.startswith('"') and boundary.endswith('"'):
            boundary = boundary[1:-1]

        attachments_dir = self.state.attachments_dir

        saved_files: list[dict[str, str]] = []
        parts = body.split(("--" + boundary).encode())
        for part in parts:
            if b"Content-Disposition" not in part:
                continue
            header_end = part.find(b"\r\n\r\n")
            if header_end < 0:
                continue
            header = part[:header_end].decode("utf-8", errors="replace")
            file_data = part[header_end + 4:]
            if file_data.endswith(b"\r\n"):
                file_data = file_data[:-2]

            filename = ""
            if 'filename="' in header:
                start = header.index('filename="') + 10
                end = header.index('"', start)
                filename = header[start:end]

            if not filename:
                continue

            import uuid
            ext = Path(filename).suffix
            safe_name = f"{uuid.uuid4().hex}{ext}"
            dest = attachments_dir / safe_name
            dest.write_bytes(file_data)
            attachment_url = f"/attachments/{safe_name}"
            saved_files.append({
                "filename": filename,
                "saved_as": safe_name,
                "path": str(dest),
                "attachment_url": attachment_url,
            })
            logger.info("Uploaded: %s -> %s", filename, dest)

        if not saved_files:
            self._send_json(400, {"error": "no files found in upload"})
            return

        file_descriptions = []
        for f in saved_files:
            ext = Path(f["filename"]).suffix.lower()
            is_image = ext in (".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp")
            kind = "图片" if is_image else "文件"
            file_descriptions.append(f'{kind}: {f["filename"]} (服务器路径: {f["path"]})')

        hint_text = "用户上传了附件:\n" + "\n".join(file_descriptions)
        rec = self.state.chat.append(role="user", text=hint_text, source="pwa-upload")

        session = self.state.active_session
        ts_prefix = "[" + datetime.now().strftime("%Y-%m-%d %H:%M:%S") + "]"
        injected = f"{ts_prefix} {hint_text}"
        try:
            subprocess.Popen(
                ["tmux", "load-buffer", "-"],
                stdin=subprocess.PIPE,
            ).communicate(input=injected.encode("utf-8"))
            subprocess.run(["tmux", "paste-buffer", "-t", session, "-p"], check=False)
            subprocess.run(["tmux", "send-keys", "-t", session, "Enter"], check=False)
        except Exception as e:
            logger.warning("tmux inject fail for upload: %s", e)

        self._send_json(200, {"ok": True, "files": saved_files, "record": rec})


def run_server(config_path: str | Path):
    state = ServerState.from_config(config_path)
    RequestHandler.state = state

    server = ThreadingHTTPServer((state.host, state.port), RequestHandler)
    logger.info("Server starting on %s:%d", state.host, state.port)
    logger.info("Data dir: %s", state.chat.path.parent)
    if state.shared_secret:
        logger.info("Shared secret configured (strict_auth=%s)", state.strict_auth)
    else:
        logger.warning("No shared_secret — all requests allowed!")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        logger.info("Server shutting down")
        server.shutdown()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="CcServer Linux")
    parser.add_argument("--config", default=str(DEFAULT_CONFIG), help="Path to config.toml")
    args = parser.parse_args()
    run_server(args.config)
