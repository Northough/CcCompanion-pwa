#!/usr/bin/env python3
"""doctor.py — Check all dependencies for CcCompanion."""
import shutil
import subprocess
import sys
from pathlib import Path

def check(name, cmd, required=True):
    path = shutil.which(cmd)
    if path:
        ver = ""
        try:
            r = subprocess.run([cmd, "--version"], capture_output=True, text=True, timeout=5)
            ver = r.stdout.strip().split("\n")[0][:60]
        except Exception:
            pass
        status = "OK"
        print(f"  ✓  {name:<16} {path}  {ver}")
    else:
        status = "MISSING" if required else "OPTIONAL"
        mark = "✗" if required else "○"
        print(f"  {mark}  {name:<16} not found {'(REQUIRED)' if required else '(optional)'}")
    return path is not None or not required

print("CcCompanion Doctor — dependency check\n")

results = [
    check("python3",      "python3",      required=True),
    check("node",         "node",         required=True),
    check("npm",          "npm",          required=True),
    check("tmux",         "tmux",         required=True),
    check("claude",       "claude",       required=True),
    check("ccusage",      "ccusage",      required=False),
    check("npx",          "npx",          required=False),
]

# Check client/package.json exists
import os
# Find project root: walk up from .claude/skills/cccompanion-setup/scripts/
_HERE = Path(__file__).resolve().parent
_ROOT = _HERE
for _ in range(5):
    if (_ROOT / "client" / "package.json").exists():
        break
    _ROOT = _ROOT.parent
ROOT = _ROOT
pkg = ROOT / "client" / "package.json"
if pkg.exists():
    print(f"  ✓  package.json     {pkg}")
else:
    print(f"  ✗  package.json     not found at {pkg}")
    results.append(False)

print()
if all(results):
    print("All critical dependencies OK. Ready to configure.")
    sys.exit(0)
else:
    print("Some dependencies are missing. Install them before continuing.")
    sys.exit(1)
