#!/usr/bin/env python3
"""start.py — Start server, PWA dev server, and tmux session with Claude."""
import argparse
import subprocess
import sys
import time
from pathlib import Path

_HERE = Path(__file__).resolve().parent
_ROOT = _HERE
for _ in range(5):
    if (_ROOT / "client" / "package.json").exists():
        break
    _ROOT = _ROOT.parent
ROOT = _ROOT
SERVER_DIR = ROOT / "server"
CLIENT_DIR = ROOT / "client"


def tmux_session_exists(name):
    r = subprocess.run(["tmux", "has-session", "-t", name], capture_output=True)
    return r.returncode == 0


def start_tmux_session(name):
    if tmux_session_exists(name):
        print(f"  tmux session '{name}' already exists, skipping")
        return
    subprocess.run(["tmux", "new-session", "-d", "-s", name], check=True)
    print(f"  Created tmux session '{name}'")
    time.sleep(1)
    subprocess.run(["tmux", "send-keys", "-t", name, "claude", "Enter"], check=False)
    print(f"  Launched Claude in session '{name}'")


def start_server(port):
    """Start the Python server in the background."""
    import os
    log = open(SERVER_DIR / "server.log", "a")
    proc = subprocess.Popen(
        [sys.executable, "server.py", "--config", str(SERVER_DIR / "config.toml")],
        cwd=str(SERVER_DIR),
        stdout=log, stderr=log,
        start_new_session=True,
    )
    print(f"  Server PID {proc.pid} (port {port})")
    print(f"  Log: {SERVER_DIR / 'server.log'}")
    time.sleep(2)


def start_pwa(port):
    """Start Vite dev server in the background."""
    import os
    log = open(CLIENT_DIR / "vite.log", "a")
    proc = subprocess.Popen(
        ["npx", "vite", "--port", str(port), "--host"],
        cwd=str(CLIENT_DIR),
        stdout=log, stderr=log,
        start_new_session=True,
    )
    print(f"  PWA PID {proc.pid} (port {port})")
    print(f"  Log: {CLIENT_DIR / 'vite.log'}")
    time.sleep(3)


def main():
    p = argparse.ArgumentParser(description="Start CcCompanion services")
    p.add_argument("--server-port", type=int, default=8795)
    p.add_argument("--pwa-port", type=int, default=5174)
    p.add_argument("--session", default="cc")
    args = p.parse_args()

    print("Starting CcCompanion services...\n")

    print("[1/4] tmux session + Claude")
    start_tmux_session(args.session)

    print("[2/4] Server")
    start_server(args.server_port)

    print("[3/4] PWA dev server")
    start_pwa(args.pwa_port)

    print("[4/4] Verifying...")
    time.sleep(2)

    import urllib.request
    try:
        req = urllib.request.urlopen(f"http://localhost:{args.server_port}/health", timeout=5)
        if req.status == 200:
            print("  ✓ Server health OK")
        else:
            print(f"  ✗ Server health returned {req.status}")
    except Exception as e:
        print(f"  ✗ Server not responding: {e}")

    print("\nAll services started. Run connect_card.py for connection info.")


if __name__ == "__main__":
    main()
