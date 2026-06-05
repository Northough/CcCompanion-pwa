# CcCompanion Study MCP

CcCompanion Study exposes the learning system as a local MCP server so Claude Code can call the tools directly instead of guessing JSON.

The intended flow is:

- chat with Claude Code in the main CcCompanion chat
- let Claude Code add learning sources with `study_add_source`
- let Claude Code create quizzes or chores with `study_create_task`
- answer those tasks in the Study page
- let Claude Code judge submissions with `study_judge_task`

The MCP server shares the same data directory as the Python backend:

- sources and FTS5 index: `server/data/study_knowledge.sqlite3`
- legacy source imports, migrated automatically when present: `server/data/study_sources.jsonl`
- game state: `server/data/study_game.json`

## Tools

- `study_status`
- `study_game_state`
- `study_list_sources`
- `study_add_source`
- `study_search_sources`
- `study_create_task` accepts `title`, optional `description`, optional `questions`, optional `source_id`, `minutes`, `reward`, and `penalty`
- `study_judge_task`
- `study_add_points`
- `study_grant_item`
- `study_create_custom_item`
- `study_complete_source`

## Register With Claude Code

Recommended command:

```bash
claude mcp add cccompanion-study -- python3 /Users/anqiwu/Downloads/咲咲的claude\ code手机端/server/study_mcp_server.py --data-dir /Users/anqiwu/Downloads/咲咲的claude\ code手机端/server/data
```

Equivalent config shape if editing Claude settings manually:

```json
{
  "mcpServers": {
    "cccompanion-study": {
      "command": "python3",
      "args": [
        "/Users/anqiwu/Downloads/咲咲的claude code手机端/server/study_mcp_server.py",
        "--data-dir",
        "/Users/anqiwu/Downloads/咲咲的claude code手机端/server/data"
      ]
    }
  }
}
```

After registering, restart the Claude Code session so the tool list is refreshed.

## Smoke Test

```bash
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized","params":{}}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' \
  | python3 /Users/anqiwu/Downloads/咲咲的claude\ code手机端/server/study_mcp_server.py --data-dir /Users/anqiwu/Downloads/咲咲的claude\ code手机端/server/data
```
