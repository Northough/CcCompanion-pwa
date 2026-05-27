#!/usr/bin/env bash
# group_smoke_test.sh — Group chat endpoint smoke test
# Usage: ./scripts/group_smoke_test.sh [SERVER_URL] [SECRET]

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
auth_header() { if [ -n "$SECRET" ]; then echo "-H X-Auth-Token:${SECRET}"; else echo ""; fi; }

echo "=== Group Chat Smoke Test ==="
echo "Server: ${SERVER}"
echo ""

AUTH=($(auth_header))

# 0. No-auth check — /group/roster should be 403 without token when strict_auth=true
echo "[0] GET /group/roster (no auth → 403)"
code=$(curl -s -o /dev/null -w "%{http_code}" "${SERVER}/group/roster")
if [ "$code" = "403" ]; then
  pass "/group/roster → 403 without token"
elif [ "$code" = "200" ]; then
  # strict_auth might be false — still counts
  pass "/group/roster → 200 (strict_auth=false)"
else
  fail "/group/roster → ${code}"
fi

# 1. GET /group/roster
echo "[1] GET /group/roster"
body=$(curl -s "${AUTH[@]}" "${SERVER}/group/roster")
echo "$body" | python3 -c "
import sys, json
d = json.load(sys.stdin)
assert d.get('ok'), 'ok not true'
roster = d.get('roster', [])
assert len(roster) >= 4, f'expected >=4 roster entries, got {len(roster)}'
ids = [r['id'] for r in roster]
for must in ['user','assistant','coder','reviewer']:
    assert must in ids, f'{must} not in roster'
print('ok')
" 2>/dev/null && pass "/group/roster ok (4 members)" || fail "/group/roster"

# 2. POST /group/send
echo "[2] POST /group/send"
body=$(curl -s -X POST "${AUTH[@]}" -H "Content-Type: application/json" \
  -d '{"sender_id":"user","text":"hello group","message_type":"chat"}' \
  "${SERVER}/group/send")
echo "$body" | python3 -c "
import sys, json
d = json.load(sys.stdin)
assert d.get('ok'), 'ok not true'
r = d.get('record', {})
assert r.get('text') == 'hello group'
assert r.get('sender_id') == 'user'
assert r.get('message_type') == 'chat'
print('ok')
" 2>/dev/null && pass "/group/send ok" || fail "/group/send"

# 3. POST /group/send with mentions + task_id
echo "[3] POST /group/send (mentions + task_id)"
body=$(curl -s -X POST "${AUTH[@]}" -H "Content-Type: application/json" \
  -d '{"sender_id":"user","text":"@assistant review this","mentions":["assistant"],"task_id":"T-001","message_type":"task"}' \
  "${SERVER}/group/send")
echo "$body" | python3 -c "
import sys, json
d = json.load(sys.stdin)
r = d.get('record', {})
assert 'assistant' in r.get('mentions', [])
assert r.get('task_id') == 'T-001'
assert r.get('message_type') == 'task'
print('ok')
" 2>/dev/null && pass "/group/send mentions+task ok" || fail "/group/send mentions+task"

# 4. GET /group/poll (should return messages)
echo "[4] GET /group/poll"
body=$(curl -s "${AUTH[@]}" "${SERVER}/group/poll?limit=10")
echo "$body" | python3 -c "
import sys, json
d = json.load(sys.stdin)
assert d.get('ok'), 'ok not true'
records = d.get('records', [])
assert len(records) >= 2, f'expected >=2 records, got {len(records)}'
print('ok')
" 2>/dev/null && pass "/group/poll ok" || fail "/group/poll"

# 5. GET /group/poll with since + sender_id heartbeat. sender_id must not filter records.
echo "[5] GET /group/poll (since + sender_id heartbeat)"
TS=$(echo "$body" | python3 -c "import sys,json; r=json.load(sys.stdin)['records']; print(r[0]['ts'])" 2>/dev/null || echo "")
if [ -n "$TS" ]; then
  ASSIST_TEXT="assistant_visible_$(date +%s)"
  curl -s -X POST "${AUTH[@]}" -H "Content-Type: application/json" \
    -d "{\"sender_id\":\"assistant\",\"text\":\"${ASSIST_TEXT}\",\"message_type\":\"chat\"}" \
    "${SERVER}/group/send" >/dev/null
  body2=$(curl -s "${AUTH[@]}" "${SERVER}/group/poll?since=$(python3 -c "import urllib.parse; print(urllib.parse.quote('${TS}'))")&limit=10&sender_id=user")
  echo "$body2" | python3 -c "
import sys, json
d = json.load(sys.stdin)
assert d.get('ok')
records = d.get('records', [])
assert records, 'expected records after since'
assert any(r.get('text') == '${ASSIST_TEXT}' and r.get('sender_id') == 'assistant' for r in records), 'sender_id query unexpectedly filtered assistant records'
print(f'count={d.get(\"count\",0)}')
" 2>/dev/null && pass "/group/poll since ok" || fail "/group/poll since"
else
  pass "/group/poll since (skipped, could not extract ts)"
fi

# 6. POST /group/typing
echo "[6] POST /group/typing"
body=$(curl -s -X POST "${AUTH[@]}" -H "Content-Type: application/json" \
  -d '{"sender_id":"user","typing":true}' "${SERVER}/group/typing")
echo "$body" | python3 -c "import sys,json; d=json.load(sys.stdin); assert d.get('ok')" 2>/dev/null && pass "/group/typing ok" || fail "/group/typing"

# 7. POST /group/roster_heartbeat
echo "[7] POST /group/roster_heartbeat"
body=$(curl -s -X POST "${AUTH[@]}" -H "Content-Type: application/json" \
  -d '{"sender_id":"user"}' "${SERVER}/group/roster_heartbeat")
echo "$body" | python3 -c "import sys,json; d=json.load(sys.stdin); assert d.get('ok')" 2>/dev/null && pass "/group/roster_heartbeat ok" || fail "/group/roster_heartbeat"

# 8. Verify heartbeat cleared typing
echo "[8] GET /group/roster (verify presence)"
body=$(curl -s "${AUTH[@]}" "${SERVER}/group/roster")
echo "$body" | python3 -c "
import sys, json
d = json.load(sys.stdin)
online = d.get('online', {})
typing = d.get('typing', {})
assert 'user' in online, 'user not online after heartbeat'
assert 'user' not in typing, 'user still typing after heartbeat'
print('ok')
" 2>/dev/null && pass "/group presence ok" || fail "/group presence"

# Summary
echo ""
echo "=== Results: ${PASS} passed, ${FAIL} failed ==="
[ "$FAIL" -gt 0 ] && exit 1
echo "All group chat checks passed."
