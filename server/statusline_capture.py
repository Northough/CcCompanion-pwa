#!/usr/bin/env python3
"""statusline_capture.py — Read Claude Code statusLine JSON from stdin,
extract only safe fields, write to data/usage/statusline.json.

Usage in Claude Code settings.json:
  "statusLine": {
    "command": "python3 /path/to/statusline_capture.py --data-dir /path/to/server/data"
  }

This reads the JSON that Claude Code passes via stdin after each response.
It does NOT call claude -p, does NOT use Agent SDK, does NOT consume extra quota.
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path


SAFE_FIELDS = {
    "model", "context_window", "rate_limits", "cost",
    "session_id", "version",
}


def extract_safe(data: dict) -> dict:
    """Extract only the safe, display-relevant fields from statusline JSON."""
    out: dict = {}

    # Model
    model = data.get("model")
    if isinstance(model, dict):
        out["model"] = {
            "display_name": model.get("display_name", ""),
            "id": model.get("id", ""),
        }
    elif isinstance(model, str):
        out["model"] = {"display_name": model, "id": model}

    # Context window
    ctx = data.get("context_window")
    if isinstance(ctx, dict):
        out["context_window"] = {
            "used_percentage": ctx.get("used_percentage"),
            "remaining_percentage": ctx.get("remaining_percentage"),
            "total_tokens": ctx.get("total_tokens"),
            "used_tokens": ctx.get("used_tokens"),
        }

    # Rate limits
    rl = data.get("rate_limits")
    if isinstance(rl, dict):
        out["rate_limits"] = {}
        for key in ("five_hour", "seven_day"):
            block = rl.get(key)
            if isinstance(block, dict):
                out["rate_limits"][key] = {
                    "used_percentage": block.get("used_percentage"),
                    "resets_at": block.get("resets_at"),
                    "remaining_minutes": block.get("remaining_minutes"),
                }

    # Cost
    cost = data.get("cost")
    if isinstance(cost, dict):
        out["cost"] = {
            "total_cost_usd": cost.get("total_cost_usd"),
            "input_cost_usd": cost.get("input_cost_usd"),
            "output_cost_usd": cost.get("output_cost_usd"),
        }
    elif isinstance(cost, (int, float)):
        out["cost"] = {"total_cost_usd": cost}

    # Session / version
    if "session_id" in data:
        out["session_id"] = str(data["session_id"])[:64]
    if "version" in data:
        out["version"] = str(data["version"])[:32]

    out["updated_at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    return out


def main():
    parser = argparse.ArgumentParser(description="Capture Claude Code statusline safely")
    parser.add_argument("--data-dir", default="data", help="Path to server data directory")
    args = parser.parse_args()

    raw = sys.stdin.read()
    if not raw.strip():
        return

    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        print("statusline: invalid JSON", file=sys.stderr)
        return

    safe = extract_safe(data)

    out_dir = Path(args.data_dir) / "usage"
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / "statusline.json"

    tmp = out_path.with_suffix(".tmp")
    tmp.write_text(json.dumps(safe, ensure_ascii=False, indent=2))
    tmp.replace(out_path)

    # Print a short one-line summary to stdout (visible in statusLine output)
    model_name = safe.get("model", {}).get("display_name", "?")
    ctx_pct = safe.get("context_window", {}).get("used_percentage")
    five_hr = safe.get("rate_limits", {}).get("five_hour", {}).get("used_percentage")
    cost = safe.get("cost", {}).get("total_cost_usd")

    parts = [f"model={model_name}"]
    if ctx_pct is not None:
        parts.append(f"ctx={ctx_pct}%")
    if five_hr is not None:
        parts.append(f"5h={five_hr}%")
    if cost is not None:
        parts.append(f"${cost:.2f}")

    print(" | ".join(parts))


if __name__ == "__main__":
    main()
