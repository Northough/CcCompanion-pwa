# CcCompanion Linux + Android 部署指南

## 前置要求

- Linux 服务器 (Ubuntu 22.04+ / Debian 12+ / WSL2 / VPS)
- Python 3.11+
- tmux
- Claude Code CLI (已登录 Claude OAuth)
- Node.js 18+ (用于构建 PWA)

---

## 1. 安装依赖

```bash
# Ubuntu / Debian
sudo apt update && sudo apt install -y python3 python3-pip python3-venv tmux nodejs npm

# 安装 Claude Code
npm install -g @anthropic-ai/claude-code

# 登录 Claude OAuth
claude auth login
```

## 2. 启动 tmux 会话

```bash
# 创建名为 cc 的 tmux 会话
tmux new -s cc -d

# 在会话中启动 interactive claude
tmux send-keys -t cc "claude" Enter

# 验证会话存在
tmux list-sessions
```

## 3. 启动后端服务

```bash
cd server

# 创建虚拟环境
python3 -m venv venv
source venv/bin/activate

# 无需额外依赖 (标准库)

# 首次启动会自动生成 shared_secret
python3 server.py --config config.toml
# secret 会保存到 server/.secret
# 记下这个 secret，PWA 连接时需要

# 后台运行
nohup python3 server.py --config config.toml > server.log 2>&1 &
```

## 4. (可选) 启动 bus_stop_hook

`bus_stop_hook` 会监控 tmux 会话，自动把 Claude 的回复追加到聊天历史。

```bash
cd server
source venv/bin/activate

# 从 server 日志中获取 secret
nohup python3 bus_stop_hook.py \
  --server http://localhost:8795 \
  --session cc \
  --secret <your-secret> \
  > hook.log 2>&1 &
```

## 5. 构建 PWA

```bash
cd client

# 安装依赖
npm install

# 开发模式 (本地测试)
npm run dev
# 访问 http://localhost:5173

# 生产构建
npm run build
# 输出在 client/dist/
```

### 本地开发模式

开发模式下 Vite 会自动代理 `/chat`, `/tmux`, `/favorites`, `/settings`, `/usage` 到 `http://localhost:8795`。

在 Settings 页面填入：
- **Server URL**: `http://localhost:8795`（或留空用代理）
- **Shared Secret**: 从 server 日志获取的 secret

### 生产模式

把 `client/dist/` 部署到 Nginx/Caddy：

```nginx
# Nginx 示例
server {
    listen 80;
    server_name your-domain.com;

    location / {
        root /path/to/client/dist;
        try_files $uri $uri/ /index.html;
    }

    location ~ ^/(chat|tmux|favorites|settings|usage|health|attachments) {
        proxy_pass http://127.0.0.1:8795;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

## 6. 远程访问方案

### 方案 A: Tailscale (推荐，最简单)

```bash
# 服务器安装 Tailscale
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up

# 手机安装 Tailscale app，加入同一网络
# PWA Server URL 填: http://<tailscale-ip>:8795
```

### 方案 B: Cloudflare Tunnel

```bash
# 安装 cloudflared
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o /usr/local/bin/cloudflared
chmod +x /usr/local/bin/cloudflared

# 登录并创建 tunnel
cloudflared tunnel login
cloudflared tunnel create cc-companion

# 配置 tunnel (创建 ~/.cloudflared/config.yml)
cat > ~/.cloudflared/config.yml << EOF
tunnel: <tunnel-id>
credentials-file: ~/.cloudflared/<tunnel-id>.json

ingress:
  - hostname: cc.your-domain.com
    service: http://localhost:8795
  - service: http_status:404
EOF

# 启动
cloudflared tunnel run cc-companion
# PWA Server URL 填: https://cc.your-domain.com
```

### 方案 C: 直接端口暴露 (不推荐)

```bash
# 如果服务器有公网 IP
# 确保防火墙放行 8795
sudo ufw allow 8795

# PWA Server URL 填: http://<server-ip>:8795
# 注意: 必须配置 shared_secret
```

## 7. Android 打包 (Capacitor)

```bash
cd client

# 安装 Capacitor
npm install @capacitor/core @capacitor/cli
npm install @capacitor/android

# 初始化 Capacitor
npx cap init "CcCompanion" "com.cc.companion" --web-dir dist

# 构建 PWA
npm run build

# 同步到 Android
npx cap add android
npx cap sync

# 打开 Android Studio
npx cap open android

# 在 Android Studio 中: Build > Build APK
```

### Capacitor 配置注意事项

在 `capacitor.config.ts` 中设置 server URL：

```typescript
import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.cc.companion',
  appName: 'CcCompanion',
  webDir: 'dist',
  server: {
    // Android 包内嵌 PWA，API 请求走网络
    androidScheme: 'https',
  },
};

export default config;
```

在 Settings 页面配置远程 Server URL 后即可使用。

---

## 验证清单

### 自动化验证 (推荐)

```bash
# 从项目根目录运行
./scripts/smoke_test.sh http://localhost:8795
```

脚本会检查以下 12 项:
1. `/health` 公开可访问 (200, 无 token)
2. `/chat/history` 无 token 返回 403
3. `/chat/history` 有 token 返回 200
4. `/tmux/sessions` 有 token 返回 200
5. tmux session `cc` 存在
6. `/chat/send` 注入文本能在 tmux capture 中看到
7. `/tmux/send` 能输入到 tmux
8. `/tmux/capture` 能读取终端输出
9. `/usage/active` 不崩溃
10. `/favorites/list` 正常返回
11. `/settings` 正常返回
12. `/chat/upload` 文件上传正常

### 手动验证

- [ ] 手机浏览器打开 PWA 能看到 Chat 界面
- [ ] Settings 填入 Server URL 和 Shared Secret 后保存
- [ ] Chat 发消息 → tmux 中 Claude 收到
- [ ] Chat 输入 `/help` 显示命令列表
- [ ] Chat 输入 `/list` 显示 tmux 会话列表
- [ ] Terminal Tab 能看到 tmux 输出
- [ ] 📎 按钮能上传文件，Claude 收到文件路径提示

### Slash Commands

在 Chat 中输入以下命令 (不发送给 Claude):
- `/help` — 显示可用命令列表
- `/new [name]` — 创建新 tmux 会话
- `/list` — 列出所有 tmux 会话
- `/switch <name>` — 切换到指定会话
- `/stop` — 中止当前 Claude (Ctrl+C)
- `/clear` — 清空终端屏幕
- `/compact` — 发送 `/compact` 给 Claude 压缩上下文

---

## config.toml 完整配置

```toml
[server]
host = "0.0.0.0"       # 监听地址
port = 8795              # 监听端口
shared_secret = ""       # 留空自动生成
strict_auth = true       # true = 必须带 X-Auth-Token
data_dir = "./data"      # 数据存储目录

[tmux]
session = "cc"           # 默认 tmux 会话名
```

---

## Usage 配置（额度 + 统计）

Usage 页面显示两层数据：

1. **Claude Code 额度**（5 小时 / 7 天 rate limit、context 使用率、模型、费用）— 来自 Claude Code statusLine
2. **本地 token 统计**（token 数、burn rate、剩余时间）— 来自 ccusage

### 步骤 1：配置 Claude Code statusLine

编辑 `~/.claude/settings.json`（全局）或项目 `.claude/settings.json`：

```json
{
  "statusLine": {
    "command": "python3 /path/to/server/statusline_capture.py --data-dir /path/to/server/data"
  }
}
```

**说明**：
- Claude Code 每次回复后，会自动把状态 JSON 通过 stdin 传给这个命令
- `statusline_capture.py` 只提取安全字段（model、rate_limits、context_window、cost、session_id、version），不保存 transcript_path、cwd、token、env 等敏感数据
- 输出写入 `data/usage/statusline.json`，server 的 `/usage/active` 会读取
- stdout 打印一行简短状态（如 `model=Opus 4 | ctx=42% | 5h=35% | $1.23`）
- **不走 claude -p，不走 Agent SDK，不额外消耗额度**

### 步骤 2：安装 ccusage（可选）

ccusage 提供详细的 token 统计和 burn rate：

```bash
npm install -g ccusage
```

安装后 `/usage/active` 会自动合并 ccusage 的 `blocks --active --json` 数据。

不安装也可以——Usage 页面仍能显示额度数据，只显示"本地统计未安装"。

### 步骤 3：验证

1. 在 Claude Code 中进行一次对话
2. 打开 PWA → Usage 页面
3. 应该看到：
   - 5 Hour / 7 Day 额度百分比条
   - Context 使用率
   - 当前模型和费用
   - （如有 ccusage）token 统计和 burn rate

### 数据流

```
Claude Code 回复
  → statusLine command (stdin JSON)
  → statusline_capture.py
  → data/usage/statusline.json
  → server /usage/active 读取
  → PWA Usage 页面显示

ccusage (如果安装)
  → ccusage blocks --active --json
  → server /usage/active 合并
  → PWA Usage 页面显示
```

### 返回字段说明

`GET /usage/active` 返回：

```json
{
  "ok": true,
  "quota": {
    "five_hour": { "used_percentage": 35, "resets_at": "...", "remaining_minutes": 180 },
    "seven_day": { "used_percentage": 12, "resets_at": "..." },
    "context": { "used_percentage": 42, "remaining_percentage": 58 },
    "model": "Claude Opus 4",
    "total_cost_usd": 1.23,
    "session_id": "...",
    "version": "2.1.133"
  },
  "quota_source": "claude_statusline" | "unavailable",
  "stats": { ... } | null,
  "stats_source": "ccusage" | "unavailable"
}
```

---

## 安全提醒

- 生产环境必须设置 `shared_secret`
- 不要将 8795 端口直接暴露到公网
- 优先使用 Tailscale 或 Cloudflare Tunnel
- `strict_auth` 默认为 `true`，保持开启
