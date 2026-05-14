#!/usr/bin/env python3
"""configure.py — Write server/config.toml, server/data/settings.json, and optionally ~/.claude/settings.json."""
import argparse
import json
import os
import shutil
import sys
from pathlib import Path

_HERE = Path(__file__).resolve().parent
_ROOT = _HERE
for _ in range(5):
    if (_ROOT / "client" / "package.json").exists():
        break
    _ROOT = _ROOT.parent
ROOT = _ROOT
SERVER_DIR = ROOT / "server"
CONFIG_TOML = SERVER_DIR / "config.toml"
DATA_SETTINGS = SERVER_DIR / "data" / "settings.json"
CLAUDE_SETTINGS = Path.home() / ".claude" / "settings.json"


def write_config_toml(args):
    secret_line = f'shared_secret = "{args.secret}"' if args.secret else '# shared_secret = ""'
    strict = "true" if args.strict_auth else "false"
    content = f"""[server]
host = "0.0.0.0"
port = {args.server_port}
{secret_line}
strict_auth = {strict}
data_dir = "./data"

[tmux]
session = "cc"
"""
    if CONFIG_TOML.exists():
        backup = CONFIG_TOML.with_suffix(".toml.bak")
        shutil.copy2(CONFIG_TOML, backup)
        print(f"  Backed up {CONFIG_TOML} → {backup}")
    CONFIG_TOML.write_text(content)
    print(f"  Wrote {CONFIG_TOML}")


def write_data_settings(args):
    DATA_SETTINGS.parent.mkdir(parents=True, exist_ok=True)
    existing = {}
    if DATA_SETTINGS.exists():
        try:
            existing = json.loads(DATA_SETTINGS.read_text())
        except Exception:
            pass

    merged = {
        **existing,
        "memory_mode": args.memory_mode,
        "memory_injection_enabled": False,
        "memory_top_k": 8,
        "memory_max_chars": 1800,
    }

    # Model config (only for non-local)
    if args.memory_mode != "local":
        for key in [
            "memory_reasoning_model", "memory_reasoning_base_url", "memory_reasoning_api_key",
            "memory_embedding_model", "memory_embedding_base_url", "memory_embedding_api_key",
            "memory_vector_provider", "memory_vector_url", "memory_vector_api_key", "memory_vector_index",
        ]:
            val = getattr(args, key.replace("-", "_"), None)
            if val:
                merged[key] = val

    DATA_SETTINGS.write_text(json.dumps(merged, ensure_ascii=False, indent=2))
    print(f"  Wrote {DATA_SETTINGS}")


def write_statusline(args):
    if not args.configure_statusline:
        print("  Skipped statusLine configuration")
        return

    CLAUDE_SETTINGS.parent.mkdir(parents=True, exist_ok=True)

    existing = {}
    if CLAUDE_SETTINGS.exists():
        try:
            existing = json.loads(CLAUDE_SETTINGS.read_text())
        except Exception:
            pass

    backup = CLAUDE_SETTINGS.with_suffix(".json.bak")
    if CLAUDE_SETTINGS.exists():
        shutil.copy2(CLAUDE_SETTINGS, backup)
        print(f"  Backed up {CLAUDE_SETTINGS} → {backup}")

    statusline_script = SERVER_DIR / "statusline_capture.py"
    data_dir = SERVER_DIR / "data"
    existing["statusLine"] = {
        "type": "command",
        "command": f"python3 {statusline_script} --data-dir {data_dir}",
        "padding": 0,
    }

    CLAUDE_SETTINGS.write_text(json.dumps(existing, ensure_ascii=False, indent=2))
    print(f"  Updated {CLAUDE_SETTINGS} (statusLine configured)")


def main():
    p = argparse.ArgumentParser(description="Configure CcCompanion")
    p.add_argument("--deployment", default="local", choices=["local", "lan", "tailscale", "public"])
    p.add_argument("--server-port", type=int, default=8795)
    p.add_argument("--secret", default="")
    p.add_argument("--strict-auth", type=lambda x: x.lower() == "true", default=False)
    p.add_argument("--memory-mode", default="local", choices=["local", "worker", "vectorize-later"])
    p.add_argument("--configure-statusline", action="store_true", default=False)
    # Model config args
    p.add_argument("--memory-reasoning-model", default="")
    p.add_argument("--memory-reasoning-base-url", default="")
    p.add_argument("--memory-reasoning-api-key", default="")
    p.add_argument("--memory-embedding-model", default="")
    p.add_argument("--memory-embedding-base-url", default="")
    p.add_argument("--memory-embedding-api-key", default="")
    p.add_argument("--memory-vector-provider", default="")
    p.add_argument("--memory-vector-url", default="")
    p.add_argument("--memory-vector-api-key", default="")
    p.add_argument("--memory-vector-index", default="")
    args = p.parse_args()

    print("Configuring CcCompanion...\n")
    write_config_toml(args)
    write_data_settings(args)
    write_statusline(args)
    print("\nDone. Run start.py to launch services.")


if __name__ == "__main__":
    main()
