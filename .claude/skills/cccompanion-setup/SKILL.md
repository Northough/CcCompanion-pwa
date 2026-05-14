---
name: cccompanion-setup
description: Guided CcCompanion setup — check deps, configure server, launch services, output connection card.
---

# CcCompanion Setup Skill

When the user says "帮我配置 CcCompanion", "设置手机伴侣", "CcCompanion 初始化", or similar setup requests, run this skill.

## Step 1: Collect configuration

Ask the user these questions ONE message at a time. Do NOT skip any.

### Q1: Deployment location
- **本机开发** (localhost, strict_auth=false, no password needed)
- **局域网** (LAN IP, password required)
- **Tailscale** (Tailscale hostname, password required)
- **Cloudflare Tunnel / 公网** (public domain, password required)

### Q2: Password
- If deployment is "本机开发": default to `strict_auth=false`, no password
- Otherwise: ask user to choose:
  - **自动生成**强密码 (recommended)
  - **手动输入**密码
- Password must be at least 16 chars

### Q3: Port
- Server port: default 8795
- PWA dev port: default 5174
- Ask if user wants to change

### Q4: Memory mode
- **local** (recommended, no extra setup)
- **worker** (external worker, ask for base_url later)
- **vectorize later** (skip for now)

### Q5: Model configuration (only if memory_mode != "local-json")
Ask for:
- memory_reasoning_model (e.g. "claude-sonnet-4-20250514")
- memory_reasoning_base_url
- memory_reasoning_api_key
- memory_embedding_model (e.g. "bge-m3")
- memory_embedding_base_url
- memory_embedding_api_key
- memory_vector_provider (e.g. "cloudflare-vectorize")
- memory_vector_url
- memory_vector_api_key
- memory_vector_index

If memory_mode is "local", skip all of these.

### Q6: StatusLine
- "是否配置 Claude Code statusLine 自动采集额度数据？" (recommended: yes)
- If yes, configure ~/.claude/settings.json

## Step 2: Run doctor

```bash
python3 .claude/skills/cccompanion-setup/scripts/doctor.py
```

Report results. If any critical dep is missing, tell the user how to install it before continuing.

## Step 3: Install dependencies

```bash
cd client && npm install
```

## Step 4: Write configuration

```bash
python3 .claude/skills/cccompanion-setup/scripts/configure.py \
  --deployment <mode> \
  --server-port <port> \
  --secret <secret_or_empty> \
  --strict-auth <true|false> \
  --memory-mode <mode> \
  [--memory-reasoning-model ...] \
  [--memory-embedding-model ...] \
  [--memory-vector-provider ...]
```

## Step 5: Start services

```bash
python3 .claude/skills/cccompanion-setup/scripts/start.py \
  --server-port <port> \
  --pwa-port <pwa_port> \
  --session cc
```

## Step 6: Output connection card

```bash
python3 .claude/skills/cccompanion-setup/scripts/connect_card.py \
  --server-port <port> \
  --pwa-port <pwa_port> \
  --secret <secret_or_empty> \
  --deployment <mode>
```

Show the card output to the user.

## Step 7: Verify

Run quick checks:
```bash
curl -s http://localhost:<port>/health
curl -s -H "X-Auth-Token: <secret>" http://localhost:<port>/diag
```

Report success or fix issues.

## Important rules
- Do NOT modify server code
- Do NOT modify client code
- Do NOT install global packages (ccusage is optional)
- Always backup ~/.claude/settings.json before modifying
- Always ask before overwriting existing config.toml
