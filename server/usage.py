"""Claude Code usage — merges statusline quota data with ccusage token stats."""
from __future__ import annotations

import json
import logging
import shutil
import subprocess
import threading
import time
from pathlib import Path
from typing import Any

logger = logging.getLogger("cc-server.usage")

CACHE_TTL_SECONDS = 30

# ccusage binary search order
CCUSAGE_CANDIDATES = ["ccusage", "npx", "npx -y ccusage"]


def _find_ccusage() -> list[str] | None:
    """Find ccusage binary. Returns command list or None."""
    if shutil.which("ccusage"):
        return ["ccusage"]
    if shutil.which("npx"):
        return ["npx", "-y", "ccusage"]
    return None


class UsageReader:
    def __init__(self, data_dir: str | Path | None = None, cache_ttl: int = CACHE_TTL_SECONDS):
        self._lock = threading.Lock()
        self._cache_ttl = cache_ttl
        self._cached: dict[str, Any] | None = None
        self._cached_at: float = 0.0
        self._statusline_path: Path | None = None
        if data_dir:
            self._statusline_path = Path(data_dir) / "usage" / "statusline.json"

    def get_active(self) -> dict[str, Any]:
        now = time.time()
        with self._lock:
            if self._cached is not None and (now - self._cached_at) < self._cache_ttl:
                return self._cached
        snapshot = self._fetch()
        with self._lock:
            self._cached = snapshot
            self._cached_at = time.time()
        return snapshot

    def _read_statusline(self) -> dict[str, Any]:
        """Read statusline.json written by statusline_capture.py."""
        if not self._statusline_path or not self._statusline_path.exists():
            return {}
        try:
            return json.loads(self._statusline_path.read_text())
        except Exception:
            return {}

    def _fetch_ccusage(self) -> dict[str, Any]:
        """Try to get token/cost/burn data from ccusage."""
        cmd = _find_ccusage()
        if cmd is None:
            return {"available": False, "reason": "ccusage_not_found"}

        try:
            proc = subprocess.run(
                cmd + ["blocks", "--active", "--json"],
                capture_output=True, text=True, timeout=8,
            )
        except FileNotFoundError:
            return {"available": False, "reason": "ccusage_not_found"}
        except subprocess.TimeoutExpired:
            return {"available": False, "reason": "ccusage_timeout"}
        except Exception as e:
            return {"available": False, "reason": f"subprocess_error: {e}"}

        if proc.returncode != 0:
            return {"available": False, "reason": f"exit_{proc.returncode}"}

        try:
            data = json.loads(proc.stdout)
        except Exception:
            return {"available": False, "reason": "json_parse_fail"}

        blocks = data.get("blocks") or []
        active = next((b for b in blocks if b.get("isActive")), None)
        if not active:
            return {"available": True, "active_block": None}

        token_counts = active.get("tokenCounts") or {}
        burn = active.get("burnRate") or {}
        projection = active.get("projection") or {}

        return {
            "available": True,
            "active_block": {
                "start_time": active.get("startTime"),
                "end_time": active.get("endTime"),
                "models": active.get("models") or [],
                "entries": active.get("entries", 0),
                "total_tokens": active.get("totalTokens", 0),
                "input_tokens": token_counts.get("inputTokens", 0),
                "output_tokens": token_counts.get("outputTokens", 0),
                "cost_usd": active.get("costUSD", 0.0),
                "burn_tokens_per_min": burn.get("tokensPerMinute", 0.0),
                "projection_remaining_min": projection.get("remainingMinutes", 0),
            },
        }

    def _fetch(self) -> dict[str, Any]:
        sl = self._read_statusline()
        cc = self._fetch_ccusage()

        result: dict[str, Any] = {"ok": True}

        # --- Quota from statusline ---
        rl = sl.get("rate_limits", {})
        five_hr = rl.get("five_hour", {})
        seven_day = rl.get("seven_day", {})
        ctx = sl.get("context_window", {})
        model = sl.get("model", {})
        cost = sl.get("cost", {})

        result["quota"] = {
            "five_hour": {
                "used_percentage": five_hr.get("used_percentage"),
                "resets_at": five_hr.get("resets_at"),
                "remaining_minutes": five_hr.get("remaining_minutes"),
            },
            "seven_day": {
                "used_percentage": seven_day.get("used_percentage"),
                "resets_at": seven_day.get("resets_at"),
                "remaining_minutes": seven_day.get("remaining_minutes"),
            },
            "context": {
                "used_percentage": ctx.get("used_percentage"),
                "remaining_percentage": ctx.get("remaining_percentage"),
            },
            "model": model.get("display_name") or model.get("id") or "",
            "total_cost_usd": cost.get("total_cost_usd"),
            "session_id": sl.get("session_id", ""),
            "version": sl.get("version", ""),
            "updated_at": sl.get("updated_at", ""),
        }
        result["quota_source"] = "claude_statusline" if sl.get("updated_at") else "unavailable"

        # --- Token stats from ccusage ---
        if cc.get("available") and cc.get("active_block"):
            ab = cc["active_block"]
            result["stats"] = {
                "total_tokens": ab["total_tokens"],
                "input_tokens": ab["input_tokens"],
                "output_tokens": ab["output_tokens"],
                "cost_usd": ab["cost_usd"],
                "burn_tokens_per_min": ab["burn_tokens_per_min"],
                "projection_remaining_min": ab["projection_remaining_min"],
                "models": ab["models"],
                "entries": ab["entries"],
                "start_time": ab["start_time"],
                "end_time": ab["end_time"],
            }
            result["stats_source"] = "ccusage"
        else:
            result["stats"] = None
            result["stats_source"] = "unavailable"

        return result
