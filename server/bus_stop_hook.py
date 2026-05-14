"""bus_stop_hook — Polls tmux session, detects Claude replies, appends to chat history.

Usage:
    python3 bus_stop_hook.py --server http://localhost:8795 --session cc --secret <secret>
"""
from __future__ import annotations

import argparse
import json
import subprocess
import time
import urllib.request
from datetime import datetime

SHELL_PROMPTS = ("$", "%", "#", "❯", ">", "~]#", "]$")
NOISE_KEYWORDS = ("Welcome to Claude Code", "Checking connectivity", "╭─", "╰─", "│", "Claude Code v")


def capture_tmux(session: str, lines: int = 10) -> str:
    try:
        result = subprocess.run(
            ["tmux", "capture-pane", "-t", session, "-p", "-S", str(-lines)],
            capture_output=True, text=True, timeout=3,
        )
        return result.stdout if result.returncode == 0 else ""
    except Exception:
        return ""


def get_last_user_ts(server: str, secret: str) -> str | None:
    """Get the ts of the last user message from chat history."""
    url = f"{server}/chat/history?limit=5"
    req = urllib.request.Request(url)
    if secret:
        req.add_header("X-Auth-Token", secret)
    try:
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read())
            for rec in reversed(data.get("records", [])):
                if rec.get("role") == "user" and rec.get("source") == "pwa":
                    return rec.get("ts")
    except Exception:
        pass
    return None


def get_active_session(server: str, secret: str) -> str | None:
    """Read the backend's active tmux session so Chat replies follow /new and /switch."""
    url = f"{server}/chain/sessions"
    req = urllib.request.Request(url)
    if secret:
        req.add_header("X-Auth-Token", secret)
    try:
        with urllib.request.urlopen(req, timeout=3) as resp:
            data = json.loads(resp.read())
            active = data.get("active")
            if isinstance(active, str) and active.strip():
                return active.strip()
    except Exception:
        pass
    return None


def post_append(server: str, text: str, secret: str) -> bool:
    url = f"{server}/chat/append"
    body = json.dumps({"text": text, "source": "claude-code"}).encode("utf-8")
    req = urllib.request.Request(url, data=body, method="POST")
    req.add_header("Content-Type", "application/json")
    if secret:
        req.add_header("X-Auth-Token", secret)
    try:
        with urllib.request.urlopen(req, timeout=5) as resp:
            return resp.status == 200
    except Exception:
        return False


def post_typing(server: str, secret: str, is_typing: bool):
    """Update typing state on the server."""
    url = f"{server}/chat/typing_state"
    body = json.dumps({"is_typing": is_typing}).encode("utf-8")
    req = urllib.request.Request(url, data=body, method="POST")
    req.add_header("Content-Type", "application/json")
    if secret:
        req.add_header("X-Auth-Token", secret)
    try:
        with urllib.request.urlopen(req, timeout=3):
            pass
    except Exception:
        pass


def is_noise_line(line: str) -> bool:
    stripped = line.strip()
    if not stripped:
        return True
    for kw in NOISE_KEYWORDS:
        if kw in stripped:
            return True
    for prompt in SHELL_PROMPTS:
        if stripped.endswith(prompt) or stripped.startswith(prompt):
            return True
    # Shell command echo lines
    if stripped.startswith("$ ") or stripped.startswith("> ") or stripped.startswith("% "):
        return True
    return False


def extract_claude_reply(content: str) -> str | None:
    """Extract only Claude's actual reply text from tmux capture, filtering noise."""
    lines = content.strip().split("\n")
    if not lines:
        return None

    # Find the latest idle marker (✻) line.
    marker_idx = -1
    for i, line in enumerate(lines):
        if "✻" in line:
            marker_idx = i

    if marker_idx < 0:
        return None

    start_idx = -1
    for i in range(marker_idx - 1, -1, -1):
        if lines[i].strip().startswith("⏺"):
            start_idx = i
            break
        if lines[i].strip().startswith("❯"):
            break
    if start_idx < 0:
        return None

    reply_lines = []
    for i in range(start_idx, marker_idx):
        line = lines[i].rstrip()
        stripped = line.strip()
        if stripped.startswith("⏺"):
            line = line.replace("⏺", "", 1).lstrip()
        reply_lines.append(line)

    # Strip leading/trailing empty lines
    while reply_lines and not reply_lines[0].strip():
        reply_lines.pop(0)
    while reply_lines and not reply_lines[-1].strip():
        reply_lines.pop()

    text = "\n".join(reply_lines).strip()
    if not text:
        return None

    # Filter out single-char artifacts or shell echoes
    if len(text) < 2:
        return None

    return text


def main():
    parser = argparse.ArgumentParser(description="bus_stop_hook — tmux → chat history bridge")
    parser.add_argument("--server", default="http://localhost:8795")
    parser.add_argument("--session", default="cc")
    parser.add_argument("--follow-active", action="store_true", default=True)
    parser.add_argument("--secret", default="")
    parser.add_argument("--interval", type=float, default=3.0)
    parser.add_argument("--idle-marker", default="✻")
    args = parser.parse_args()

    last_content_hash = ""
    idle_count = 0
    IDLE_THRESHOLD = 3
    last_posted_hash = 0
    last_user_ts = None

    print(f"bus_stop_hook: watching tmux session '{args.session}' every {args.interval}s")
    if args.follow_active:
        print("bus_stop_hook: follow-active enabled")
    print(f"bus_stop_hook: server={args.server}")
    current_session = args.session

    while True:
        time.sleep(args.interval)
        watch_session = args.session
        if args.follow_active:
            watch_session = get_active_session(args.server, args.secret) or args.session
            if watch_session != current_session:
                print(f"bus_stop_hook: switched watch session {current_session} -> {watch_session}")
                current_session = watch_session
                last_content_hash = ""
                idle_count = 0

        content = capture_tmux(watch_session, lines=30)
        if not content:
            continue

        current_hash = hash(content)

        if current_hash == last_content_hash:
            idle_count += 1
        else:
            idle_count = 0
            last_content_hash = current_hash

        if idle_count >= IDLE_THRESHOLD and args.idle_marker in content:
            reply_text = extract_claude_reply(content)
            if reply_text:
                reply_hash = hash(reply_text)
                if reply_hash != last_posted_hash:
                    print(f"[{datetime.now().strftime('%H:%M:%S')}] Detected reply ({len(reply_text)} chars)")
                    if post_append(args.server, reply_text, args.secret):
                        last_posted_hash = reply_hash
                        print("  → appended to history")
                    else:
                        print("  → append failed")
            idle_count = 0


if __name__ == "__main__":
    main()
