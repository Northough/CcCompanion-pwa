"""MCP server exposing CcCompanion Study tools to Claude Code.

This is a small stdio JSON-RPC MCP implementation with no third-party
dependencies. It shares the same StudyStore data files used by server.py.
"""
from __future__ import annotations

import argparse
import json
import sys
import traceback
from pathlib import Path
from typing import Any, Callable

from study_store import StudyStore

HERE = Path(__file__).resolve().parent
DEFAULT_DATA_DIR = HERE / "data"


def text_result(payload: Any) -> dict[str, Any]:
    return {
        "content": [
            {
                "type": "text",
                "text": json.dumps(payload, ensure_ascii=False, indent=2),
            }
        ]
    }


def ok(payload: Any = None) -> dict[str, Any]:
    return {"ok": True} if payload is None else {"ok": True, **payload}


class StudyMcpServer:
    def __init__(self, data_dir: str | Path):
        self.store = StudyStore(data_dir)
        self.tools: dict[str, tuple[dict[str, Any], Callable[[dict[str, Any]], Any]]] = {}
        self._register_tools()

    def _register(self, spec: dict[str, Any], handler: Callable[[dict[str, Any]], Any]):
        self.tools[spec["name"]] = (spec, handler)

    def _register_tools(self):
        self._register({
            "name": "study_status",
            "description": "读取学习系统状态，包括资料数量、知识片段、积分和待完成任务数。",
            "inputSchema": {"type": "object", "properties": {}, "additionalProperties": False},
        }, lambda args: self.store.status())

        self._register({
            "name": "study_game_state",
            "description": "读取完整游戏化学习状态：积分、任务、背包、商店、最近积分流水。",
            "inputSchema": {"type": "object", "properties": {}, "additionalProperties": False},
        }, lambda args: self.store.game())

        self._register({
            "name": "study_list_sources",
            "description": "列出学习资料库中的资料、章节和完成状态。",
            "inputSchema": {"type": "object", "properties": {}, "additionalProperties": False},
        }, lambda args: {"sources": self.store.list_sources()})

        self._register({
            "name": "study_add_source",
            "description": "把 URL、网页、文本、Markdown 或笔记加入学习知识库。URL 会自动抓取并清洗正文。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "title": {"type": "string", "description": "资料标题，可为空。"},
                    "topic": {"type": "string", "description": "学习主题或课程名，可为空。"},
                    "url": {"type": "string", "description": "要抓取的网页 URL，可为空。"},
                    "text": {"type": "string", "description": "直接加入的正文，可为空。"},
                    "kind": {"type": "string", "description": "资料类型，例如 url/text/markdown/note。"},
                },
                "additionalProperties": False,
            },
        }, lambda args: {"source": self.store.add_source(
            title=args.get("title", ""),
            topic=args.get("topic", ""),
            url=args.get("url", ""),
            text=args.get("text", ""),
            kind=args.get("kind", "text"),
        )})

        self._register({
            "name": "study_search_sources",
            "description": "搜索学习知识库，返回与问题最相关的资料片段。回答学习问题前优先调用。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "搜索问题或关键词。"},
                    "limit": {"type": "integer", "description": "返回片段数量，默认 8。"},
                    "source_id": {"type": "string", "description": "限定某个资料 ID，可为空。"},
                },
                "required": ["query"],
                "additionalProperties": False,
            },
        }, lambda args: {"hits": self.store.search(
            args.get("query", ""),
            limit=int(args.get("limit", 8) or 8),
            source_id=args.get("source_id") or None,
        )})

        self._register({
            "name": "study_create_task",
            "description": "由 AI 发布学习任务。用户不能自己创建任务；请在需要推动学习时调用。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "title": {"type": "string", "description": "任务名。"},
                    "description": {"type": "string", "description": "任务说明或题干，可为空。"},
                    "questions": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "要在 Study 页面作答的题目列表，可为空。",
                    },
                    "source_id": {"type": "string", "description": "关联资料 ID，可为空。"},
                    "minutes": {"type": "integer", "description": "限时分钟，默认 30。"},
                    "reward": {"type": "integer", "description": "完成奖励积分，默认 10。"},
                    "penalty": {"type": "integer", "description": "失败惩罚积分，默认 -5。"},
                },
                "required": ["title"],
                "additionalProperties": False,
            },
        }, lambda args: {"task": self.store.add_task(
            args.get("title", ""),
            minutes=int(args.get("minutes", 30) or 30),
            reward=int(args.get("reward", 10) or 10),
            penalty=int(args.get("penalty", -5) or -5),
            description=args.get("description", ""),
            questions=args.get("questions") if isinstance(args.get("questions"), list) else None,
            source_id=args.get("source_id", ""),
        )})

        self._register({
            "name": "study_judge_task",
            "description": "由 AI 判定任务是否通过，并自动加减积分。用户提交任务后请调用这个工具。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "id": {"type": "string", "description": "任务 ID，例如 task_0001。"},
                    "passed": {"type": "boolean", "description": "是否通过。"},
                    "comment": {"type": "string", "description": "简短评语。"},
                },
                "required": ["id", "passed"],
                "additionalProperties": False,
            },
        }, lambda args: {"task": self.store.complete_task(
            args.get("id", ""),
            passed=bool(args.get("passed", True)),
            note=args.get("comment", ""),
        )})

        self._register({
            "name": "study_add_points",
            "description": "由 AI 主动调整积分，用于额外奖励或惩罚。不要滥用，原因必须具体。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "amount": {"type": "integer", "description": "积分变化，正数奖励，负数惩罚。"},
                    "reason": {"type": "string", "description": "原因。"},
                },
                "required": ["amount", "reason"],
                "additionalProperties": False,
            },
        }, lambda args: {"points": self.store.add_points(
            int(args.get("amount", 0) or 0),
            args.get("reason", "AI调整积分"),
        )})

        self._register({
            "name": "study_grant_item",
            "description": "由 AI 直接发放一个道具到用户背包。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "id": {"type": "string", "description": "道具 ID，例如 hint/double/shield/skip 或自定义 ID。"},
                    "name": {"type": "string", "description": "道具名。"},
                    "desc": {"type": "string", "description": "道具说明。"},
                    "kind": {"type": "string", "description": "道具类型。"},
                },
                "required": ["id"],
                "additionalProperties": False,
            },
        }, lambda args: {"item": self.store.grant_item(
            args.get("id", ""),
            args.get("name", ""),
            args.get("desc", ""),
            args.get("kind", "ai"),
        )})

        self._register({
            "name": "study_create_custom_item",
            "description": "由 AI 在商店上架限时自定义道具，适合盲盒、奖励和特殊惩罚玩法。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "name": {"type": "string", "description": "道具名。"},
                    "desc": {"type": "string", "description": "道具说明。"},
                    "price": {"type": "integer", "description": "价格。"},
                    "effect": {"type": "string", "description": "道具效果。"},
                    "minutes": {"type": "integer", "description": "上架分钟数。"},
                },
                "required": ["name"],
                "additionalProperties": False,
            },
        }, lambda args: {"item": self.store.add_custom_item(
            args.get("name", ""),
            args.get("desc", ""),
            int(args.get("price", 30) or 30),
            args.get("effect", ""),
            int(args.get("minutes", 60) or 60),
        )})

        self._register({
            "name": "study_complete_source",
            "description": "由 AI 判定资料/章节学习通过后调用。会标记完成并奖励积分。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "id": {"type": "string", "description": "资料 ID，例如 src_0001。"},
                },
                "required": ["id"],
                "additionalProperties": False,
            },
        }, lambda args: {"source": self.store.complete(args.get("id", ""), True)})

    def handle(self, msg: dict[str, Any]) -> dict[str, Any] | None:
        method = msg.get("method")
        msg_id = msg.get("id")
        try:
            if method == "initialize":
                return {
                    "jsonrpc": "2.0",
                    "id": msg_id,
                    "result": {
                        "protocolVersion": "2024-11-05",
                        "capabilities": {"tools": {}},
                        "serverInfo": {"name": "cccompanion-study", "version": "0.1.0"},
                    },
                }
            if method == "notifications/initialized":
                return None
            if method == "ping":
                return {"jsonrpc": "2.0", "id": msg_id, "result": {}}
            if method == "tools/list":
                return {
                    "jsonrpc": "2.0",
                    "id": msg_id,
                    "result": {"tools": [spec for spec, _ in self.tools.values()]},
                }
            if method == "tools/call":
                params = msg.get("params") or {}
                name = params.get("name")
                args = params.get("arguments") or {}
                if name not in self.tools:
                    raise ValueError(f"unknown tool: {name}")
                _, handler = self.tools[name]
                result = handler(args if isinstance(args, dict) else {})
                return {"jsonrpc": "2.0", "id": msg_id, "result": text_result(ok(result if isinstance(result, dict) else {"result": result}))}
            if msg_id is None:
                return None
            return {
                "jsonrpc": "2.0",
                "id": msg_id,
                "error": {"code": -32601, "message": f"Method not found: {method}"},
            }
        except Exception as exc:
            return {
                "jsonrpc": "2.0",
                "id": msg_id,
                "error": {"code": -32000, "message": str(exc), "data": traceback.format_exc(limit=3)},
            }

    def run(self):
        for line in sys.stdin:
            line = line.strip()
            if not line:
                continue
            try:
                msg = json.loads(line)
            except Exception:
                continue
            response = self.handle(msg)
            if response is not None:
                sys.stdout.write(json.dumps(response, ensure_ascii=False) + "\n")
                sys.stdout.flush()


def main():
    parser = argparse.ArgumentParser(description="CcCompanion Study MCP server")
    parser.add_argument("--data-dir", default=str(DEFAULT_DATA_DIR), help="CcCompanion server data directory")
    args = parser.parse_args()
    StudyMcpServer(args.data_dir).run()


if __name__ == "__main__":
    main()
