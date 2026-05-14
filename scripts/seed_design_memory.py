#!/usr/bin/env python3
"""Seed memory store with design-original sample data."""
import sys, json
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent.parent / "server" / "data"
if len(sys.argv) > 1:
    DATA_DIR = Path(sys.argv[1])

MEM = DATA_DIR / "memories.jsonl"
PEND = DATA_DIR / "memory_pending.jsonl"
DATA_DIR.mkdir(parents=True, exist_ok=True)

MEMORIES = [
    {"id":"mem_0001","type":"preference","content":"说话风格偏简洁，能不解释就不解释。回复多用短句。","evidence":"2026-04-29 chat: 别给我写长篇大论，给我能用的版本就行。","status":"active","confidence":0.94,"created_at":"2026-04-29T19:02:00+08:00","updated_at":"2026-04-29T19:02:00+08:00"},
    {"id":"mem_0002","type":"project","content":"正在做 Cc Companion，一个 Claude Code 手机伴侣 PWA，目标是手机上远程跑 Claude Code。","evidence":"2026-05-14 设计迁移时确认。","status":"active","confidence":0.98,"created_at":"2026-05-13T15:00:00+08:00","updated_at":"2026-05-13T15:00:00+08:00"},
    {"id":"mem_0003","type":"instruction","content":"默认模型用 opus，thinking 模式设为 adaptive，permission 模式默认 ask each time。","evidence":"2026-05-10 settings: 用户主动改的。","status":"active","confidence":0.86,"created_at":"2026-05-10T22:31:00+08:00","updated_at":"2026-05-10T22:31:00+08:00"},
    {"id":"mem_0004","type":"state","content":"当前正在调试 cache_read_tokens 偏低的问题，怀疑是 memory 注入层每轮重排序导致前缀失效。","evidence":"2026-05-13 14:48 chat 原话。","status":"active","confidence":0.91,"created_at":"2026-05-13T14:51:00+08:00","updated_at":"2026-05-13T14:51:00+08:00"},
    {"id":"mem_0005","type":"relation","content":"参考仓库 CyberSealNull/CcCompanion，只作产品结构和 API 思路参考。","evidence":"项目初始需求。","status":"active","confidence":0.99,"created_at":"2026-05-13T15:01:00+08:00","updated_at":"2026-05-13T15:01:00+08:00"},
    {"id":"mem_0006","type":"preference","content":"不喜欢花哨的人机恋功能、Timeline、Diary、虚拟手机桌面这类装饰性 UI。","evidence":"明确要求不做 Timeline/Diary/Cron/多 Agent 剧场。","status":"active","confidence":0.97,"created_at":"2026-05-13T15:02:00+08:00","updated_at":"2026-05-13T15:02:00+08:00"},
    {"id":"mem_0007","type":"instruction","content":"所有 API 调用要封装到独立文件，不要写死在组件里。","evidence":"2026-04-15 chat 提到。","status":"superseded","confidence":0.7,"created_at":"2026-04-15T10:18:00+08:00","updated_at":"2026-04-15T10:18:00+08:00"},
    {"id":"mem_0008","type":"preference","content":"老款偏好：每条 commit 信息要带 emoji 前缀。","evidence":"2025-11 chat，但近期 commit 已不再使用 emoji。","status":"expired","confidence":0.4,"created_at":"2025-11-22T09:00:00+08:00","updated_at":"2025-11-22T09:00:00+08:00"},
]

PENDING_ITEMS = [
    {"id":"mem_0009","type":"preference","content":"可能偏好深色模式（最近 3 次访问都在晚上 22 点后）。","evidence":"访问时间分析","confidence":0.62,"status":"pending","created_at":"2026-05-14T10:00:00+08:00","updated_at":"2026-05-14T10:00:00+08:00"},
    {"id":"mem_0010","type":"state","content":"可能正在搬家（提到新家网速、快递地址）。","evidence":"聊天内容分析","confidence":0.55,"status":"pending","created_at":"2026-05-14T10:00:00+08:00","updated_at":"2026-05-14T10:00:00+08:00"},
]

def write_jsonl(path, items):
    with path.open("w", encoding="utf-8") as f:
        for item in items:
            f.write(json.dumps(item, ensure_ascii=False) + "\n")
    print(f"Wrote {len(items)} items → {path}")

write_jsonl(MEM, MEMORIES)
write_jsonl(PEND, PENDING_ITEMS)
print("Done.")
