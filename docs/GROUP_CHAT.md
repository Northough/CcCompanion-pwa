# 工作群 / Group Chat

Group Chat is a lightweight message bus for multi-member coordination within CcCompanion. It provides a shared chat room accessible from the PWA, where each member is identified by a `sender_id`.

## What This Is

- A **message bus** — messages are stored in JSONL and broadcast via polling.
- Supports **roster** (member list), **@mentions**, **typing/online presence**, and **task-type messages**.
- Includes a small **agent bridge**: Claude-like members are delivered through tmux, while Codex-like `app_server` members are consumed automatically through local Codex exec and can also use inbox/reply endpoints.

## Architecture

```
PWA (GroupView)  ──poll/post──▶  server.py  ──read/write──▶  group_messages.jsonl
                                           ├─read/write──▶  group_state.json
                                           ├─tmux bridge─▶  Claude Code session
                                           └─Codex bridge▶  codex exec / agent API
```

There is no push mechanism; clients poll every 2 seconds for new messages.
The agent bridge also polls every ~2 seconds for new Group messages targeted at tmux-backed or Codex-backed agents.

## Default Roster

| ID          | Name      | Color   |
|-------------|-----------|---------|
| `user`      | User      | `#D94683` |
| `assistant` | Assistant | `#E779A8` |
| `coder`     | Coder     | `#8B6FD1` |
| `reviewer`  | Reviewer  | `#4C9A78` |

Override the roster by placing `server/agents_config.json` next to `config.toml`:

```json
{
  "roster": [
    { "id": "user",      "name": "User",      "color": "#D94683" },
    { "id": "assistant", "name": "Assistant",  "color": "#E779A8", "model": "Claude", "bridge": "tmux", "tmux_session": "cc", "default_responder": true, "can_reply": true },
    { "id": "coder",     "name": "Coder",      "color": "#8B6FD1", "model": "Claude", "bridge": "tmux", "tmux_session": "cc", "can_reply": true },
    { "id": "reviewer",  "name": "Reviewer",   "color": "#4C9A78", "model": "Codex", "bridge": "app_server", "can_reply": true }
  ]
}
```

See `server/agents_config.example.json` for a template.

## API Endpoints

All endpoints require `X-Auth-Token` when `strict_auth = true`.

### `GET /group/roster`

Returns the current roster and presence info.

```json
{
  "ok": true,
  "roster": [...],
  "online": { "user": "2026-05-27T12:00:00+00:00" },
  "typing": {}
}
```

### `GET /group/poll?since=&limit=&sender_id=`

Poll for new messages. Returns messages whose `ts` is strictly after `since`.

- `since` — ISO timestamp (optional)
- `limit` — max messages to return (default 200, max 5000)
- `sender_id` — viewer heartbeat; marks this client online while polling (optional). It does not filter messages.

```json
{
  "ok": true,
  "records": [
    {
      "ts": "2026-05-27T12:00:00.123+00:00",
      "sender_id": "user",
      "text": "hello",
      "message_type": "chat"
    }
  ],
  "count": 1
}
```

### `POST /group/send`

```json
{
  "sender_id": "user",
  "text": "@assistant please review",
  "mentions": ["assistant"],
  "message_type": "chat",
  "task_id": "T-001",
  "delivery_targets": ["coder"]
}
```

- `sender_id` — who is sending (default `"user"`)
- `text` — message body (required)
- `mentions` — array of mentioned member IDs (optional)
- `message_type` — `"chat"` (default), `"task"`, `"system"`, etc.
- `task_id` — optional task reference
- `delivery_targets` — optional list of member IDs to notify

### `POST /group/typing`

```json
{ "sender_id": "user", "typing": true }
```

### `POST /group/roster_heartbeat`

```json
{ "sender_id": "user" }
```

Marks the sender as online and clears their typing state.

### `GET /group/agent/status`

Returns bridge status, agent bridge types, cursors, busy state, and tmux session mapping.

```json
{
  "ok": true,
  "enabled": true,
  "started": true,
  "agents": [
    { "id": "assistant", "bridge": "tmux", "tmux_session": "cc", "busy": false },
    { "id": "reviewer", "bridge": "app_server", "busy": false }
  ]
}
```

### `GET /group/agent/inbox?agent_id=&since=&limit=&mark_seen=`

Codex/app-server agents poll this endpoint for messages targeted at them. The built-in Codex bridge also uses this targeting logic before posting replies back to Group.

- Explicit `@reviewer`, `mentions`, or `delivery_targets` target that agent.
- Unmentioned user messages target only the roster member with `default_responder: true`.
- Agent messages with no mentions are ignored by other agents to prevent reply loops.
- `mark_seen=1` advances that agent's stored cursor to the last returned message.

```json
{
  "ok": true,
  "agent_id": "reviewer",
  "records": [
    { "sender_id": "assistant", "text": "@reviewer can you check this?", "mentions": ["reviewer"] }
  ],
  "cursor": "2026-06-05T12:00:00.123+08:00"
}
```

### `POST /group/agent/reply`

Codex/app-server agents post their reply back to Group.

```json
{
  "agent_id": "reviewer",
  "text": "@assistant I found the issue.",
  "ack_ts": "2026-06-05T12:00:00.123+08:00"
}
```

### `POST /group/agent/ack`

Advance an agent cursor without sending a reply.

```json
{ "agent_id": "reviewer", "ts": "2026-06-05T12:00:00.123+08:00" }
```

## Data Storage

- `server/data/group_messages.jsonl` — append-only message log
- `server/data/group_state.json` — roster, online map, typing map

Both are created automatically in the configured `data_dir`.

## Important Limitations

1. **Claude replies depend on tmux screen capture.** The bridge injects messages into the configured tmux session and captures the next stable Claude Code reply.
2. **Codex uses local Codex exec by default.** `app_server` roster members are consumed by the Python bridge through `codex exec` with read-only sandboxing; the inbox/reply endpoints remain available for a future persistent app-server adapter.
3. **No push notifications.** Clients and bridges poll every ~2 seconds. There is no WebSocket or SSE layer.
4. **No APNs / Bark / iOS push.** This is a pure PWA + Python stdlib stack.
5. **No Agent SDK.** Claude Code stays on the interactive tmux path.

## Smoke Test

```bash
./scripts/group_smoke_test.sh
```

Tests 9 checks: no-auth guard, roster, send, send with mentions+task, poll, poll with since, typing, heartbeat, and presence.
