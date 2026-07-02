# CcCompanion 云部署说明（给云端 Claude 读）

> 这份文档描述**当前代码库的真实状态**，用于在云服务器上部署。
> 项目里其它旧文档（README、SETUP_LINUX_ANDROID.md）部分内容已过时，以本文为准。
> 关键差异见文末「与旧文档的出入」。

## 1. 这是什么 / 架构

一个"从手机远程操控一台机器上已登录的 Claude Code 会话"的 PWA。核心链路：

```
手机 PWA  →  Python HTTP 服务(server.py)  →  tmux 会话  →  交互式 claude CLI
```

- **不走 Agent SDK、不走 `claude -p`**。日常对话是把文本用 `tmux paste-buffer` 打进一个常驻的交互式 `claude` 里，再用 `tmux capture-pane` 把回复抓回来。
- 所以云服务器上**必须**：同机、同用户下有 ①一个跑着 `claude` 的 tmux 会话 ②Python 服务。两者必须在同一台机、同一用户。
- 每个"会话/对话"= 一个独立 tmux session + 一个独立 claude 进程（新建对话 = `tmux new-session` + 起新 `claude`）。

## 2. 前置依赖（云服务器）

- Linux（Ubuntu 22.04+ / Debian 12+）
- **Python 3.11+**（后端是**纯标准库**，无第三方依赖、无 requirements.txt）
- **tmux**
- **Node 18+** + `@anthropic-ai/claude-code`，且**已完成 OAuth 登录**（`claude` 交互一次登录）
- 可选：`ccusage`（用量统计）、`codex`（群聊里的 Codex 成员，用不到可忽略）

## 3. 后端部署

```bash
# 1) 起一个常驻 tmux 会话并在里面启动 claude
tmux new -s cc -d
tmux send-keys -t cc "claude" Enter        # 首次需在该会话里完成 claude 登录

# 2) 配置并启动 Python 服务
cd server
cp config.example.toml config.toml         # 按需改；shared_secret 留空会自动生成到 server/.secret
python3 server.py --config config.toml      # 前台先验证
# 后台常驻：
nohup python3 server.py --config config.toml > server.log 2>&1 &
```

**config.toml 要点**（见 `config.example.toml`）：
- `[server] host="0.0.0.0" port=8795`
- `shared_secret`：留空则首次启动自动生成到 `server/.secret`。**公网/隧道场景务必设置并保持 `strict_auth=true`**。
- `data_dir="./data"`：所有服务器端数据都在这（**首次运行自动创建**）。
- `[tmux] session="cc"`：默认操控的 tmux 会话名，要和上面 `tmux new -s cc` 一致。

**建议用 systemd 常驻**（项目没自带 unit，需自己写）：一个 unit 跑 `python3 server.py`，另一个（或手动）保证 `tmux`+`claude` 常驻。tmux 会话本身在 SSH 断开后不受影响，但机器重启后要重新拉起。

## 4. 前端部署

```bash
cd client
npm install
npm run build        # 产物在 client/dist/
```

把 `dist/` 交给 Nginx/Caddy 托管，并把 API 路径反代到 `127.0.0.1:8795`。**当前前端实际会用到的 API 前缀**：

```
/chat  /tmux  /chain  /study  /group  /usage  /settings  /health  /diag  /attachments
```

Nginx 示例（注意比旧文档多了 `/chain /study /group /diag`）：

```nginx
server {
    listen 80;
    server_name your-domain;
    location / { root /path/to/client/dist; try_files $uri $uri/ /index.html; }
    location ~ ^/(chat|tmux|chain|study|group|usage|settings|health|diag|attachments|favorites) {
        proxy_pass http://127.0.0.1:8795;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

手机端打开 PWA → Settings 里填 **Server URL** 和 **Shared Secret**（本机同域可用"一键连接本机"）。这两个值存在浏览器 localStorage。

## 5. 远程访问 + 安全

- **优先 Tailscale 或 Cloudflare Tunnel**，别把 8795 直接裸暴露公网。
- 隧道/公网场景：**必须**设 `shared_secret` 且 `strict_auth=true`。
- `X-Auth-Token` 头 = shared_secret。
- ⚠️ `/tmux/capture` 和 `/chat/history` 会暴露你本地终端与对话内容——**远程访问 = 别人能操控你这台机的 Claude 会话**，务必控好密钥与隧道。

## 6. 本次改动带来的部署要点（重要，和旧文档不同）

### 6.1 记忆(memory)功能已整体移除
- 前后端都删了：`memory_store.py`、`/memory/*` 路由、聊天注入逻辑、Settings 里的记忆项、`settings.py` 里的 `memory_*` 默认项。
- **别再按旧文档配 memory 或 memory MCP**，不存在了。

### 6.2 指令浮窗（AI 下达倒计时任务）—— 需要装 Skill
- 机制：Claude 在**普通回复里嵌入记号** `[[task:标题:秒]]` → 前端解析弹出倒计时浮窗；用户完成/取消/超时后，会以一条聊天消息把结果回传给 Claude。**没有新增后端端点，寄生在 /chat 上**。
- **要让云端 Claude 会下任务，必须让它能读到 `issue-task` 这个 skill**：把 `.claude/skills/issue-task/` 放到**那个在 tmux 里跑的 claude 所在项目的 `.claude/skills/`**，或放 `~/.claude/skills/` 做全局。（详见 `docs/COMMAND_FLOATWINDOW.md`）
- 超时 60 分钟无响应会自动结束并回执。

### 6.3 新增会话生命周期命令（需要 tmux）
前端 Chat 里可用 `/restart`（清空 Claude 上下文但保留同一会话）、`/kill`（结束当前 claude 进程）、`/claude`（重启）。对应后端 `/chain/restart`、`/chain/kill`，用 `tmux respawn-pane -k` 实现，**依赖 tmux 正常**。`/restart` 里有个固定 `0.6s` 等待重启，机器慢时若偶尔没接上，可把 `_handle_chain_restart` 里的 `time.sleep(0.6)` 调大。

### 6.4 这些功能是「纯前端 / 存在手机浏览器 localStorage」，服务器上没有它们的数据
- **收藏**（`cc_favorites_v1`）、**删除单条消息**（本地隐藏 `cc_hidden_msgs`）、**日程**（`cccompanion:function:schedule:v1`）、**指令浮窗状态**（`cc_commands_v1`）、**本地回执/测试消息**（`cc_local_echo_v1`）、**Server URL / 密钥 / 个人资料**。
- 含义：**换设备/清缓存这些会丢，服务器备份里也找不到**。后端 `/favorites/*`、`/chat/delete` 端点仍在，但当前前端不调用（保留备用，将来做"收藏导出到服务器/让 AI 可见"时可接上）。
- 所以云端要备份用户数据时，重点备份的是 **`server/data/`**（聊天历史、study、group、attachments、settings、usage），而不是收藏/日程（那些在手机上）。

### 6.5 Study（可选）
Study 面板走独立 MCP：`claude mcp add cccompanion-study -- python3 /abs/path/server/study_mcp_server.py --data-dir /abs/path/server/data`，注册后重启 claude。详见 `docs/STUDY_MCP.md`。用不到可跳过。

### 6.6 用量(Usage)（可选）
配 Claude Code statusLine 指向 `server/statusline_capture.py`，可选装 `ccusage`。详见 `docs/SETUP_LINUX_ANDROID.md` 的 Usage 段。

## 7. 已知隐患 / 注意

- **聊天历史无限增长**：所有对话都写在单个 `data/chat_history.jsonl`，**每次读都全文件扫描**（无索引）。用久了文件变大、读取变慢。目前的缓解只有"新建对话分区""删除整个会话回收"。若要长期高频用，建议后续加：前端内存封顶 + 后端按对话保留最近 N 条（尚未实现）。
- **前端删除是"本地隐藏"**：不回收服务器 JSONL 空间（那是显示层的事，且 Claude 读的是 tmux 不是 JSONL，所以隐藏与后端删除对 Claude 效果相同）。
- **心跳保活尚未实现**：`/diag` 能报 `claude_running`（靠 tmux 截屏里有没有 `✻`）。将来若做保活，可复用它检测 + 用 6.3 的 restart 逻辑自动拉起。

## 8. 上线快速自检

```bash
curl -s localhost:8795/health                       # {"ok":true,...}
curl -s -H "X-Auth-Token: <secret>" localhost:8795/diag   # tmux_ok / claude_running / sessions
tmux list-sessions                                   # 应看到 cc
```
- 手机 PWA → Settings 填 URL+密钥 → 发一条消息，tmux 里 claude 应收到；回复应抓回聊天。
- Chat 打 `/help` 看命令列表（含 /restart /kill /claude）。
- 让 Claude 在回复里带 `[[task:测试:60]]` → 浮窗应弹出（前提：装了 `issue-task` skill）。

## 附：与旧文档的出入（一句话汇总）
- ❌ memory / memory MCP：已删，别配。
- ➕ Nginx 反代要多带 `/chain /study /group /diag`。
- ➕ 需装 `issue-task` skill 才能让 Claude 下倒计时任务。
- ➕ 新增 `/chain/restart`、`/chain/kill` 端点（依赖 tmux）。
- ℹ️ 收藏/删除/日程是手机本地数据，不在服务器；服务器要备份的是 `server/data/`。
