#!/usr/bin/env bash
# smoke_test.sh — Full endpoint smoke test for CcServer
# Usage: ./scripts/smoke_test.sh [SERVER_URL] [SECRET]

set -euo pipefail

SERVER="${1:-http://localhost:8795}"
SECRET="${2:-}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SECRET_FILE="${SCRIPT_DIR}/../server/.secret"

if [ -z "$SECRET" ] && [ -f "$SECRET_FILE" ]; then
  SECRET="$(cat "$SECRET_FILE")"
fi

PASS=0; FAIL=0
pass() { echo "  PASS  $1"; PASS=$((PASS + 1)); }
fail() { echo "  FAIL  $1"; FAIL=$((FAIL + 1)); }
auth() { if [ -n "$SECRET" ]; then echo "-H X-Auth-Token:$SECRET"; else echo ""; fi; }

echo "=== CcServer Smoke Test ==="
echo "Server: ${SERVER}"
echo ""

# 1. /health (public)
echo "[1] GET /health"
code=$(curl -s -o /dev/null -w "%{http_code}" "${SERVER}/health")
[ "$code" = "200" ] && pass "/health 200" || fail "/health ${code}"

# 2. /diag
echo "[2] GET /diag"
body=$(curl -s -H "X-Auth-Token: ${SECRET}" "${SERVER}/diag")
echo "$body" | python3 -c "import sys,json; d=json.load(sys.stdin); assert d.get('ok')" 2>/dev/null && pass "/diag ok" || fail "/diag"

# 3. /chat/send
echo "[3] POST /chat/send"
body=$(curl -s -X POST -H "X-Auth-Token: ${SECRET}" -H "Content-Type: application/json" -d '{"text":"smoke"}' "${SERVER}/chat/send")
echo "$body" | python3 -c "import sys,json; d=json.load(sys.stdin); assert d.get('ok')" 2>/dev/null && pass "/chat/send ok" || fail "/chat/send"

# 4. /chat/history
echo "[4] GET /chat/history"
body=$(curl -s -H "X-Auth-Token: ${SECRET}" "${SERVER}/chat/history?limit=5")
echo "$body" | python3 -c "import sys,json; d=json.load(sys.stdin); assert d.get('ok')" 2>/dev/null && pass "/chat/history ok" || fail "/chat/history"

# 5. /tmux/capture
echo "[5] GET /tmux/capture"
body=$(curl -s -H "X-Auth-Token: ${SECRET}" "${SERVER}/tmux/capture?session=cc&lines=5")
echo "$body" | python3 -c "import sys,json; d=json.load(sys.stdin); assert d.get('ok')" 2>/dev/null && pass "/tmux/capture ok" || fail "/tmux/capture"

# 6. /tmux/send
echo "[6] POST /tmux/send"
body=$(curl -s -X POST -H "X-Auth-Token: ${SECRET}" -H "Content-Type: application/json" -d '{"keys":"echo test","enter":true}' "${SERVER}/tmux/send")
echo "$body" | python3 -c "import sys,json; d=json.load(sys.stdin); assert d.get('ok')" 2>/dev/null && pass "/tmux/send ok" || fail "/tmux/send"

# 7. /chain/new_session
echo "[7] POST /chain/new_session"
body=$(curl -s -X POST -H "X-Auth-Token: ${SECRET}" -H "Content-Type: application/json" -d '{"name":"smoke-test"}' "${SERVER}/chain/new_session")
echo "$body" | python3 -c "import sys,json; d=json.load(sys.stdin); assert d.get('ok')" 2>/dev/null && pass "/chain/new_session ok" || fail "/chain/new_session"
# cleanup
tmux kill-session -t smoke-test 2>/dev/null || true

# 8. /memory/status
echo "[8] GET /memory/status"
body=$(curl -s -H "X-Auth-Token: ${SECRET}" "${SERVER}/memory/status")
echo "$body" | python3 -c "import sys,json; d=json.load(sys.stdin); assert d.get('ok')" 2>/dev/null && pass "/memory/status ok" || fail "/memory/status"

# 9. /memory/create
echo "[9] POST /memory/create"
body=$(curl -s -X POST -H "X-Auth-Token: ${SECRET}" -H "Content-Type: application/json" \
  -d '{"type":"instruction","content":"smoke test memory","evidence":"smoke test"}' "${SERVER}/memory/create")
echo "$body" | python3 -c "import sys,json; d=json.load(sys.stdin); assert d.get('ok')" 2>/dev/null && pass "/memory/create ok" || fail "/memory/create"
MEM_ID=$(echo "$body" | python3 -c "import sys,json; print(json.load(sys.stdin)['memory']['id'])" 2>/dev/null || echo "")

# 10. /memory/search
echo "[10] GET /memory/search"
body=$(curl -s -H "X-Auth-Token: ${SECRET}" "${SERVER}/memory/search?q=smoke")
echo "$body" | python3 -c "import sys,json; d=json.load(sys.stdin); assert d.get('ok') and len(d.get('memories',[]))>0" 2>/dev/null && pass "/memory/search ok" || fail "/memory/search"

# 11. /memory/pending/accept
echo "[11] POST /memory/pending/accept"
body=$(curl -s -H "X-Auth-Token: ${SECRET}" "${SERVER}/memory/pending")
PEND_ID=$(echo "$body" | python3 -c "import sys,json; d=json.load(sys.stdin); p=d.get('pending',[]); print(p[0]['id'] if p else '')" 2>/dev/null || echo "")
if [ -n "$PEND_ID" ]; then
  body=$(curl -s -X POST -H "X-Auth-Token: ${SECRET}" -H "Content-Type: application/json" \
    -d "{\"id\":\"${PEND_ID}\"}" "${SERVER}/memory/pending/accept")
  echo "$body" | python3 -c "import sys,json; d=json.load(sys.stdin); assert d.get('ok')" 2>/dev/null && pass "/memory/pending/accept ok" || fail "/memory/pending/accept"
else
  pass "/memory/pending/accept (no pending items, skipped)"
fi

# 12. /usage/active
echo "[12] GET /usage/active"
code=$(curl -s -o /dev/null -w "%{http_code}" -H "X-Auth-Token: ${SECRET}" "${SERVER}/usage/active")
[ "$code" = "200" ] && pass "/usage/active 200" || fail "/usage/active ${code}"

# 13. /chat/upload
echo "[13] POST /chat/upload"
tmpfile=$(mktemp /tmp/smoke_XXXXXX.txt)
echo "smoke upload test" > "$tmpfile"
body=$(curl -s -X POST -H "X-Auth-Token: ${SECRET}" -F "file=@${tmpfile}" "${SERVER}/chat/upload")
rm -f "$tmpfile"
echo "$body" | python3 -c "import sys,json; d=json.load(sys.stdin); assert d.get('ok') and len(d.get('files',[]))>0" 2>/dev/null && pass "/chat/upload ok" || fail "/chat/upload"

# 14. /memory/delete (cleanup)
if [ -n "$MEM_ID" ]; then
  echo "[14] POST /memory/delete (cleanup)"
  body=$(curl -s -X POST -H "X-Auth-Token: ${SECRET}" -H "Content-Type: application/json" \
    -d "{\"id\":\"${MEM_ID}\"}" "${SERVER}/memory/delete")
  echo "$body" | python3 -c "import sys,json; d=json.load(sys.stdin); assert d.get('ok')" 2>/dev/null && pass "/memory/delete ok" || fail "/memory/delete"
fi

# Summary
echo ""
echo "=== Results: ${PASS} passed, ${FAIL} failed ==="
[ "$FAIL" -gt 0 ] && exit 1
echo "All checks passed."
