# CcCompanion API Surface — Linux Port Analysis

Source: `CyberSealNull/CcCompanion` `apns-server/push.py`

## Endpoint Classification

### Core (Linux Port — Keep)

| Endpoint | Method | Purpose | Notes |
|---|---|---|---|
| `/health` | GET | Health check | Remove APNs fields, keep `ok`, add `version` |
| `/chat/history` | GET | Fetch chat JSONL | `?since=&before=&limit=&around_ts=` |
| `/chat/send` | POST | User message → tmux inject | `{text, quoted_ts?, location?}` |
| `/chat/append` | POST | Assistant reply → history | `{text, source?, role?}` — called by bus_stop_hook |
| `/chat/search` | GET | Search history | `?q=&date=&role=&limit=` |
| `/chat/delete` | POST | Delete one record | `{ts}` |
| `/chat/react` | POST | Toggle emoji reaction | `{ts, emoji}` |
| `/chat/regenerate` | POST | Mark old + append new | `{old_ts, new_text}` |
| `/chat/status` | GET | Typing state + last ts | |
| `/tmux/capture` | GET | tmux pane capture | `?session=&lines=` — core terminal view |
| `/tmux/send` | POST | Send keys to tmux | `{keys, session?, enter?}` |
| `/tmux/sessions` | GET | List tmux sessions | |
| `/favorites/list` | GET | List favorites | `?type=&tag=&q=&limit=&offset=` |
| `/favorites/get` | GET | Get one favorite | `?id=` |
| `/favorites/add` | POST | Add favorite | `{type, source, refs, tags?, note?}` |
| `/favorites/edit` | POST | Edit favorite | `{id, tags?, note?}` |
| `/favorites/delete` | POST | Delete favorite | `{id}` |
| `/attachments/<path>` | GET | Serve attachment file | Static file serving |
| `/settings` | GET | Get settings snapshot | |
| `/settings` | POST | Update setting | `{key, value}` |
| `/usage/active` | GET | ccusage active block | Falls back gracefully if ccusage not installed |

### APNs / iOS-Only (Drop for Linux)

| Endpoint | Reason |
|---|---|
| `/register-token` | APNs Live Activity token registration |
| `/unregister-token` | APNs token cleanup |
| `/register-device-token` | APNs device token |
| `/push` | APNs push trigger (state → Live Activity) |
| `/push/clear-unread` | APNs unread badge clear |
| `/tokens` | List APNs tokens |
| `/chat/typing` | APNs typing indicator (Live Activity) |
| `/chat/poll` | Task capsule polling (APNs fallback) |

### Private / Deferred (Not in v1 Linux)

| Endpoint | Reason |
|---|---|
| `/diary/*` (all) | Diary system — out of scope per requirements |
| `/timeline/*` (all) | Timeline system — out of scope |
| `/pet/*` (all) | Pet state / virtual pet — cosmetic |
| `/rp/*` (all) | Roleplay sessions — out of scope |
| `/group/*` (all) | Group chat — complex, deferred |
| `/calendar/*` (all) | Calendar system — deferred |
| `/task/*` (all) | Task queue — deferred |
| `/chain/*` (all) | Multi-session chain management — deferred |
| `/todos/*` (all) | Todo system — deferred |
| `/studyroom/*` (all) | Study room — deferred |
| `/reminders/*` (all) | Reminders — deferred |
| `/tts/*` (all) | TTS — requires external service |
| `/system/lock` | macOS lock screen — platform-specific |
| `/admin/rotate-secret` | Secret rotation — keep as future feature |

## Architecture Notes

### Chat Send Flow (CcCompanion Original)
```
iOS App → POST /chat/send → server writes JSONL → subprocess bus_send.py → tmux inject
tmux session reply → bus_stop_hook → POST /chat/append → server writes JSONL → APNs push
iOS App polls /chat/history?since=<ts>
```

### Chat Send Flow (Linux Port)
```
PWA → POST /chat/send → server writes JSONL → subprocess tmux inject
Claude replies in tmux → bus_stop_hook reads tmux capture periodically → POST /chat/append
PWA polls /chat/history?since=<ts>
```

### tmux Capture Flow
```
PWA → GET /tmux/capture?session=cc&lines=120
Server runs: tmux capture-pane -t cc -p -S -120
Returns: {ok, session, content}
```

### tmux Send Flow
```
PWA → POST /tmux/send {keys: "hello", session: "cc", enter: true}
Server runs: tmux load-buffer - (stdin: keys) → tmux paste-buffer -t cc → tmux send-keys Enter
```

### Auth Model
- `X-Auth-Token` header = `shared_secret` from config
- `strict_auth=true` (default): unauthenticated requests return 403
- `strict_auth=false`: unauthenticated requests allowed with warning log

### Data Storage
- Chat history: JSONL file (`chat_history.jsonl`)
- Favorites: JSONL + optional markdown vault
- Settings: JSON file (`settings.json`)
- All paths configurable via `config.toml`
