# Cc Companion Mobile

A lightweight mobile companion for Claude Code.

The core path is intentionally simple:

```text
Android / PWA client
  -> Python HTTP server
  -> tmux session
  -> interactive claude CLI
```

This project is for remotely controlling an existing local Claude Code session from a phone. Daily chat uses the interactive `claude` CLI through tmux, not Agent SDK and not `claude -p`.

## What Works

- PWA chat UI adapted from the Claude Design prototype
- Terminal view backed by `tmux capture-pane`
- tmux send keys / special keys / abort
- Slash commands: `/new`, `/list`, `/switch`, `/stop`, `/clear`, `/help`, `/compact`
- File upload and attachment links
- Local JSONL chat history, favorites, and memory store
- Optional memory injection
- Basic usage panel with `ccusage` and Claude Code statusLine support
- Setup skill for guided local/LAN/Tailscale deployment

## Project Layout

```text
client/                         PWA frontend
server/                         Python server and tmux bridge
scripts/                        smoke tests and seed helpers
docs/                           setup and API notes
.claude/skills/cccompanion-setup Guided setup skill
```

Local runtime files are intentionally ignored:

- `server/.secret`
- `server/config.toml`
- `server/data/`
- `client/node_modules/`
- `client/dist/`

Use `server/config.example.toml` as the template for a real local config.

## Quick Start

Install Claude Code and log in first:

```bash
claude
```

Start a tmux session:

```bash
tmux new -s cc
claude
```

In another terminal, start the server:

```bash
cd server
cp config.example.toml config.toml
python3 server.py --config config.toml
```

Start the PWA:

```bash
cd client
npm install
npm run dev -- --host 0.0.0.0 --port 5174
```

Open the PWA, go to Settings, set the server URL and shared secret, then start chatting.

## Guided Setup Skill

In Claude Code, use:

```text
帮我配置 CcCompanion
```

The setup skill checks local dependencies, writes config, optionally configures Claude Code statusLine, starts the server and PWA, then prints a connection card for the phone.

## Security Notes

- Keep `strict_auth = true` for LAN, Tailscale, Cloudflare Tunnel, or any public reverse proxy.
- Do not commit `server/.secret`, `server/config.toml`, or `server/data/`.
- Terminal capture may include sensitive shell output. Treat remote access as control over your local Claude Code session.
- Prefer Tailscale or a private LAN while this is still early-stage software.
