# 工作群 / Group Chat

Group Chat is a lightweight message bus for multi-member coordination within CcCompanion. It provides a shared chat room accessible from the PWA, where each member is identified by a `sender_id`.

## What This Is

- A **message bus** — messages are stored in JSONL and broadcast via polling.
- Supports **roster** (member list), **@mentions**, **typing/online presence**, and **task-type messages**.
- Designed for future multi-agent coordination (e.g., assistant, coder, reviewer) but does **not** automatically control tmux sessions or spawn agents. That orchestration is left to external tooling.

## Architecture

```
PWA (GroupView)  ──poll/post──▶  server.py  ──read/write──▶  group_messages.jsonl
                                           ──read/write──▶  group_state.json
```

There is no push mechanism; clients poll every 2 seconds for new messages.

## Default Roster

| ID          | Name      | Color   |
|-------------|-----------|---------|
| `user`      | User      | `#B85C2E` |
| `assistant` | Assistant | `#4F7B4A` |
| `coder`     | Coder     | `#3A6FA0` |
| `reviewer`  | Reviewer  | `#8B5CF6` |

Override the roster by placing `server/agents_config.json` next to `config.toml`:

```json
{
  "roster": [
    { "id": "user",      "name": "User",      "color": "#B85C2E" },
    { "id": "assistant", "name": "Assistant",  "color": "#4F7B4A" },
    { "id": "coder",     "name": "Coder",      "color": "#3A6FA0" },
    { "id": "reviewer",  "name": "Reviewer",   "color": "#8B5CF6" }
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

## Data Storage

- `server/data/group_messages.jsonl` — append-only message log
- `server/data/group_state.json` — roster, online map, typing map

Both are created automatically in the configured `data_dir`.

## Important Limitations

1. **No automatic agent orchestration.** This version is purely a message bus. It does not spawn tmux sessions, run Claude instances, or dispatch tasks to agents.
2. **No push notifications.** Clients poll every ~2 seconds. There is no WebSocket or SSE layer.
3. **No APNs / Bark / iOS push.** This is a pure PWA + Python stdlib stack.
4. **No Agent SDK.** The group chat is decoupled from Claude Code's interactive CLI.

## Smoke Test

```bash
./scripts/group_smoke_test.sh
```

Tests 9 checks: no-auth guard, roster, send, send with mentions+task, poll, poll with since, typing, heartbeat, and presence.
