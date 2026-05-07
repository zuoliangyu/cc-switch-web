# CC Switch Web

中文 | [English](README_EN.md) | [日本語](README_JA.md)

## 项目说明

CC Switch Web 是 [cc-switch](https://github.com/farion1231/cc-switch) 的 Web 分支仓库。

当前仓库用于承载 CC Switch 的 Web 方向相关工作，包括 Web 端实现、相关实验以及分支上的定制化调整。

当前目标架构为：

- 前端：Web
- 后端：本地 Rust 服务
- 访问方式：浏览器访问 `http://localhost:xxxx`

这个方向面向 Windows、macOS、Linux 以及无桌面的 Linux 服务器场景。

## 当前版本

当前仓库版本为 `0.5.1`。

`0.5.1` 是工程侧补丁，无业务行为改动：vitest 测试矩阵从 0.4.0 基线 26 fail 收敛到 **0 fail**（184 passed + 2 skipped = 186/186）。修齐多类滞后问题：

- 类型 / 形状滞后：`McpFormModal` apps、`useDirectorySettings.resolvedDirs`、`useSettings.resetAllDirectories` 形参补 `hermes` / `openclaw`
- API 改名 / 协议改动：`useImportSkillArchives`（原 `useInstallSkillsFromZip`）、`useImportExport` 整套按 Web hook 新 API 重写（`selectImportUpload(File)` / `importConfigFromUpload` / `downloadConfigExport` 返回 blob+fileName）、`updateProvider` payload 形态、本地 web 端口 `8788 → 8890`
- UI / 行为差异：虚拟列表用 heading 断言、selectedCount 双处用 `getAllByText`、`EditProviderDialog onSubmit` 与真实组件对齐成 `{ provider, originalId }`、`useTranslation` 锁定 i18n 引用避免 useEffect 反复跑、App 集成测试加 `retry: 2`
- Web 模式下已不适用 2 条 `it.skip`：`SettingsDialog` 的原生 file dialog 与 browse 按钮端到端流（Web 没有这些 UI 入口，等价行为有单元测试覆盖）

后端 `cargo test --lib --test-threads=1` 仍然 775/775 全过、`pnpm tsc` 0 错误。

`0.5.0` 是例行依赖升级 + 测试夹具修复版本：

- 修复 `OpenClaw delete_session_updates_index_and_removes_jsonl` 测试 fixture 在 Windows 临时路径下因反斜杠被当成非法 JSON escape 而失败的问题（改用 `serde_json::json!` 构造数据，让 serde 自动转义路径）。后端 cargo 测试现在 775/775 全过、零 pre-existing 失败。
- 前端依赖在 minor / patch 范围内统一升级（`@tanstack/react-query` / `@codemirror/*` / `framer-motion` / `i18next` / `react-i18next` / `prettier` / `vite` 7.3.x / `tailwindcss` 3.4.x 等共 24 项）。明确跳过了 `react` 18→19、`tailwindcss` 3→4、`vite` 7→8、`typescript` 5→6、`vitest` 2→4 这些会引入 breaking changes 的 major 升级，留待后续单独迭代。

`0.4.0` 落地 0.3.x 系列中跨度最大的延后项 B1：跨源 usage 去重。

**问题背景**：proxy 实时写入与 session-log 同步过去用不同的 `request_id` 生成规则——只有 Claude 走原生 Anthropic 后端时共享 `session:{message_id}` key；Codex / Gemini / Claude-through-OpenAI compat 路径产生的 `request_id` 总是不同，主键去重失效，每笔真实请求被记录两次，dashboard 用量翻倍。

**解决方案**：

- `TokenUsage` 扩展 `message_id` 字段与 `dedup_request_id()` 方法（Claude API `body.id` / `message_start.message.id` 提取），proxy 写入与 session-log 同步现在共享 `session:{msg_xxx}` 主键，主键去重生效
- proxy logger 改 INSERT OR REPLACE：撞上同 key 时后到的更完整数据替代前者
- SQL 层 7 维指纹去重 filter：`(app_type, 4 个 token 计数, 2xx 状态, model 大小写不敏感, created_at±10min 窗口)`，覆盖 Codex / Gemini / Claude-through-OpenAI 这类 request_id 不共享的路径
- Filter 全面应用到查询（summary/provider/model/logs/limits）、写入（3 个 session_usage_*.rs 的 INSERT 前判定）、rollup（usage_daily_rollups 不再吸收 session_log 重复数据）三层
- 升 minor 版本到 0.4.0：`TokenUsage` 是 `pub` 类型，新增 `message_id` 属于 ABI 变化

至此 0.3.x 系列规划的所有 B1 / C7 / F1 延后项全部完成。完整列表与上游 commit 引用见 `CHANGELOG.md` 与 `docs-dev/web-parity-post-3.14-2026-05.md`。

`0.3.2` 继续推进 `0.3.1` 中标记为延后的两项：

- Codex 切换供应商历史稳定（上游 `a1e6c3b6`）：CC Switch 切换 Codex provider 后 `codex resume` 看到"历史换了一个"的问题，根因是 Codex 按 `model_provider` 字段过滤会话历史，旧实现在 `rightcode` / `aihubmix` 这类自定义 id 之间漂移。本版本在 provider 主导的写入边界引入稳定 provider id 归一化机制（优先复用已有的自定义 id，否则回退 `ccswitch`），并同步重写匹配的 `[profiles.*]` 引用；backfill 路径反向还原回模板原始 id，避免反向污染。包含 8 条新单测覆盖归一化与 backfill 还原。
- Usage perf（上游 `f061b777` 中未被 `518d945e` 撤销的部分）：dashboard 范围查询新增 `(app_type, created_at DESC)` 覆盖索引；补齐 GPT-5.4（3 条）与 GPT-5.5（6 条）默认定价 seed，配合 0.3.1 的 `find_model_pricing_row` 大小写不敏感修复，进一步消除 dashboard ghost-zero-cost 行。

`0.3.1` 跟进 `0.3.0` 发布之后上游 `cc-switch` 累计的一批修复，按"对 Web 后端有直接价值"筛过后落地：

- 代理流式：`message_delta` 重复 finish_reason 去重 + pending 缓存延后到 `[DONE]` 发送（修复 OpenRouter / Kimi-K2.6 多次 finish 触发 Anthropic 客户端 abort）、Vertex AI 完整 URL 保留、Kimi/Moonshot 路径保留 `reasoning_content`、DashScope/Codex OAuth `usage` 字段 null 鲁棒性
- 鉴权语义：`ANTHROPIC_AUTH_TOKEN` → `Bearer`、`ANTHROPIC_API_KEY` → `x-api-key`，与 Anthropic SDK 原生语义对齐；stream check 复用同一份头逻辑，去掉双发导致的健康检查假阴性
- Provider：DeepSeek / Kimi / Zhipu GLM / MiniMax 这类把 Anthropic 协议挂在子路径的供应商现在能正确拉取模型列表（候选 URL 顺序：`/anthropic/v1/models` → `/v1/models` → `/models`）；GitHub Copilot 的 dash 形式 Claude id（`claude-sonnet-4-6[1m]`）会被归一化为 dot 形式并按 live 列表 family fallback；SiliconFlow 国际站币种修正为 USD；Zhipu 周限额 tier 修正
- 会话：Codex explorer / 子代理产生的会话从主列表隐藏；summary 不再被 `<environment_context>` 注入污染
- 配置：`settings.json` 写出按字母序排键，消除切换时的噪声 diff；MCP 导入操作不再反向写回各应用 live 配置
- Windows 适配：JSON 配置中检测到 `%USERPROFILE%` 等白名单占位符时，编辑器弹"转为绝对路径"一键展开（Claude Code 不会自动展开 Windows 占位符）；非 Windows 平台 `try_get_version` 优先用 `$SHELL` 加载用户 PATH/alias
- Claude effort：`effortHigh` 开关从写顶层 `effortLevel` 改为写 `env.CLAUDE_CODE_EFFORT_LEVEL`（旧顶层字段在 Claude Code 实际不生效），读取阶段兼容历史数据
- Usage 鲁棒性：`find_model_pricing_row` 大小写不敏感命中 seed 定价，修复 `OpenAI/GPT-5.5@HIGH` 这类大小写不一致 model id 导致 dashboard 出现 `total_cost = 0` 的幽灵零成本行；新增 `idx_request_logs_dedup_lookup` 7 列覆盖索引为后续完整去重打基础

完整列表与每条修复对应的上游 commit、被延后到独立任务的项（B1 完整 7 维指纹去重 / C7 Codex 切换历史稳定 / F1 启动期成本 backfill），见 `CHANGELOG.md` 与 `docs-dev/web-parity-post-3.14-2026-05.md`。

当前仓库现在以 `0.1.0` 作为 Web 分支的初始发布基线。此前继承的历史发布记录已从本仓库移除，如需查看更早历史，请以上游项目记录为准。

## 与上游项目的关系

- 上游项目：[cc-switch](https://github.com/farion1231/cc-switch)
- 当前 Web 仓库：[zuoliangyu/zuoliangyu-cc-switch-web](https://github.com/zuoliangyu/zuoliangyu-cc-switch-web)
- 作者：左岚（[哔哩哔哩](https://space.bilibili.com/27619688)）
- 当前仓库聚焦于 CC Switch 的 Web 分支方向
- 如果项目定位或对外描述发生变化，仓库内各语言版本 README 需要同步更新

## 说明

如果你要查看原始的 CC Switch 项目或上游发布信息，请直接访问上游仓库。

## 最近对齐的 Web 能力与界面升级

当前 Web 分支已经补齐了以下桌面端能力，并完成了一轮 Web 界面层级升级：

- Claude、Codex、Gemini、OpenClaw 的供应商模型拉取
- Claude、Codex、Gemini 的官方订阅额度展示
- ChatGPT（Codex OAuth）托管账号中心、Claude 预设与额度展示
- 环境变量冲突检测与清理入口
- 支持通过 `?deeplink=...` 或手动输入 `ccswitch://...` 导入 Deep Link
- About 页面新增打开 GitHub 最新发布页的入口
- Provider、Settings、Skills、Sessions 页面已统一为新的工作台式界面层级
- 相关全屏面板、仓库管理面板与会话目录面板也已同步到新的 Web 视觉语言

## 运行方式

### 命令速查

| 场景 | 命令 |
| --- | --- |
| 本地开发（`w`） | `pnpm dev` |
| Docker 前台开发（`d`） | `pnpm dev -- d` |
| 本地 release 构建（`w`） | `pnpm build` |
| Docker 镜像构建（`d`） | `pnpm build -- d` |
| 项目检查 | `.\scripts\check.ps1` |
| 本地 CI 检查 | `.\scripts\ci-check.ps1` |
| Windows 本地导出产物 | `.\scripts\package-artifacts.ps1` |

脚本入口约定：

- `scripts/*.mjs` 负责跨平台主逻辑，供 `pnpm` 与 CI 直接调用
- `scripts/*.ps1` 负责 Windows 本地入口包装，便于 PowerShell 使用
- `scripts/lib/process.mjs` 与 `scripts/lib/entry.ps1` 分别承载 Node / PowerShell 的共享执行逻辑，避免重复维护

### 本地开发

1. 安装依赖：

   ```bash
   pnpm install --frozen-lockfile
   ```

   后端构建与检查需要 Rust `1.88+`。

2. 启动开发模式：

   ```bash
   pnpm dev
   ```

   显式写法：

   ```bash
   pnpm dev -- w
   ```

   Windows 下也可以直接执行：

   ```powershell
   .\scripts\dev.ps1 w
   ```

   如需手动指定端口，可使用：

   ```bash
   pnpm dev -- --frontend-port 3300 --backend-port 8890
   pnpm dev -- w -f 3300 -b 8890 --host 127.0.0.1
   ```

   Windows 下也可以：

   ```powershell
   .\scripts\dev.ps1 w -f 3300 -b 8890
   ```

3. 打开 [http://localhost:3000](http://localhost:3000)。前端会连接本地 Rust 服务 `http://127.0.0.1:8890`。
   本地开发模式下请打开前端开发地址，不要直接打开后端端口。`pnpm dev` 会默认禁用后端静态前端托管，并且会在端口不可用时自动向后尝试可用端口，然后把最终端口同时传给前端与后端。

4. `pnpm dev` 默认会打开本地调试请求日志：
   - 浏览器控制台会打印前端请求/响应日志
   - Rust 服务终端会打印 Web API 的 method/path/status/耗时
   - 如需手动覆盖，可设置 `VITE_RUNTIME_DEBUG_REQUESTS=0|1` 与 `CC_SWITCH_WEB_DEBUG_API=0|1`

### 本地 Release 二进制

1. 构建嵌入前端资源的 release 二进制：

   ```bash
   pnpm build
   ```

   显式写法：

   ```bash
   pnpm build -- w
   ```

   Windows 下也可以直接执行：

   ```powershell
   .\scripts\build.ps1 w
   ```

2. 输出路径：

   - Windows：`backend\target\release\cc-switch-web.exe`
   - Linux/macOS：`backend/target/release/cc-switch-web`

3. 直接运行对应二进制，然后打开终端中打印出的最终地址。发布态前端静态资源和 Web API 共用同一个服务端口，默认首选端口为 `8890`：

   ```bash
   ./backend/target/release/cc-switch-web --backend-port 8890
   ```

   Windows：

   ```powershell
   .\backend\target\release\cc-switch-web.exe -b 8890
   ```

   如端口被占用、被系统排除或无权限绑定，程序会自动尝试后续端口并输出最终监听地址。

4. 在本地 Web 服务模式下，CC Switch Web 自身的数据默认写入 CC Switch 使用的本地配置根目录：

   ```text
   ~/.cc-switch
   ```

   其中包括 `settings.json`、`cc-switch.db`、备份目录以及统一 Skills 存储等内容。旧的 `config.json` 不再属于当前 Web 运行时的主数据路径。

### Docker 运行

1. 构建 Docker 镜像：

   ```bash
   pnpm build -- d
   ```

   Windows 下也可以直接执行：

   ```powershell
   .\scripts\build.ps1 d
   ```

2. 以前台方式运行 Docker 组合：

   ```bash
   pnpm dev -- d
   ```

   Windows 下也可以直接执行：

   ```powershell
   .\scripts\dev.ps1 d
   ```

   如需自定义容器端口：

   ```bash
   CC_SWITCH_WEB_PORT=8895 pnpm dev -- d
   ```

   PowerShell：

   ```powershell
   $env:CC_SWITCH_WEB_PORT=8895; .\scripts\dev.ps1 d
   ```

3. 如果镜像已经构建完成，想改为后台运行，请直接使用 Docker：

   ```bash
   docker compose up -d
   docker compose logs -f
   docker compose down
   ```

4. 打开 [http://localhost:8890](http://localhost:8890) 或你自定义的端口。容器内前端和 API 也是共用同一个端口；Docker 模式默认固定 `CC_SWITCH_WEB_PORT_SCAN_COUNT=1`，避免容器内自动换端口后导致宿主机映射失效。持久化数据默认保存在 `cc-switch-web-data` volume 中。

5. 如果你希望容器内服务直接管理宿主机上的 CLI 配置目录，先复制示例文件：

   ```bash
   cp docker-compose.host.example.yml docker-compose.host.yml
   ```

   然后按你的机器修改路径，再执行：

   ```bash
   docker compose -f docker-compose.yml -f docker-compose.host.yml up -d
   ```

   当前示例文件主要面向 Linux 服务器，默认使用 `$HOME` 下的 `.claude`、`.codex`、`.gemini`、`.config/opencode`、`.config/openclaw` 目录。

### Docker 内导出 Linux 包

如果你希望在不干扰宿主机环境的前提下导出 Linux 发布包，可以直接使用 Docker Buildx：

```bash
docker buildx build --target package-linux-tar --output type=local,dest=release/docker-linux .
```

导出压缩包：

```text
release/docker-linux/cc-switch-web-linux-x64.tar.gz
```

如果你想直接导出未压缩目录：

```bash
docker buildx build --target package-linux-dir --output type=local,dest=release/docker-linux .
```

导出目录：

```text
release/docker-linux/cc-switch-web-linux-x64/
```

目录内只包含单文件可执行程序 `cc-switch-web`，解压后直接运行即可。

当前导出的 Linux 二进制为 `x86_64-unknown-linux-musl` 静态链接版本，可尽量减少宿主机运行库差异导致的问题。

### Windows 本地导出产物

如果你当前在 Windows，并且本机已经安装好 Rust 与 Docker / Buildx，可以直接执行：

```powershell
.\scripts\package-artifacts.ps1
```

如果你只想执行项目静态检查，直接运行：

```powershell
.\scripts\check.ps1
```

它只会执行现有的 Node 脚本校验、TypeScript 检查和 Rust 检查，不会触发 Docker build。

如果你要在 Windows 本地复现 CI 的完整检查链路，再运行：

```powershell
.\scripts\ci-check.ps1
```

它会先执行静态检查，再执行与 CI 对齐的 Docker smoke check，也就是 `docker build` + 容器启动 + `GET /api/health` 检查。若本机 `8890` 端口被占用，可改用：

```powershell
.\scripts\ci-check.ps1 -DockerSmokePort 8895
```

如果你更习惯走 npm script，也可以继续使用：

```powershell
pnpm check
```

Windows 本地导出脚本默认直接生成一套等价于 release 的本地产物：

- Windows 可执行文件：`release\local-artifacts\windows\cc-switch-web.exe`
- Linux 发布包：`release\local-artifacts\linux\cc-switch-web-linux-x64.tar.gz`
- Docker 镜像包：`release\local-artifacts\docker\cc-switch-web-docker-image.tar.gz`

其中：

- Windows 产物来自本机 `cargo build --locked --release`
- Linux 产物来自 Docker Buildx 的 `package-linux-tar` stage
- Docker 镜像包可通过下面命令导入：

```powershell
docker load -i .\release\local-artifacts\docker\cc-switch-web-docker-image.tar.gz
```

### Linux systemd 示例

如果你要在无桌面的 Linux 服务器上长期托管服务，可以使用仓库中的示例文件：

`deploy/systemd/cc-switch-web.service.example`

推荐步骤：

1. 在 Linux 上执行 `pnpm build` 生成二进制，或者把已打包好的 Linux 二进制放到 `/opt/cc-switch-web`。

2. 复制服务文件到系统目录：

   ```bash
   sudo cp deploy/systemd/cc-switch-web.service.example /etc/systemd/system/cc-switch-web.service
   ```

3. 按你的机器修改下面这些字段：
   - `User`
   - `Group`
   - `WorkingDirectory`
   - `HOME`
   - `ExecStart`

4. 重新加载并启动：

   ```bash
   sudo systemctl daemon-reload
   sudo systemctl enable --now cc-switch-web
   ```

5. 查看状态和日志：

   ```bash
   sudo systemctl status cc-switch-web
   sudo journalctl -u cc-switch-web -f
   ```
