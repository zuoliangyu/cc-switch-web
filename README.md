# CC Switch Web

中文 | [English](README_EN.md) | [日本語](README_JA.md)

## 项目说明

CC Switch Web 是 [cc-switch](https://github.com/farion1231/cc-switch) 的 Web 分支仓库，用于承载 CC Switch 的 Web 方向实现与分支定制。

CC Switch Web 不展示供应商的赞助商或合作伙伴标签、徽章、星标、心形或特殊高亮，也不因身份置顶。已保存的供应商列表按显示名称 A–Z 排序（忽略大小写），不提供手动拖拽排名；添加供应商时的预设按登录、厂商、第三方、云、本地、插件分组，组内按显示名称 A–Z，同一家的区域与套餐合为一行；故障转移队列仍按实际路由优先级执行。

架构与定位：

- 前端：Web
- 后端：本地 Rust 服务
- 访问方式：浏览器访问 `http://localhost:xxxx`
- 适用场景：Windows、macOS、Linux，以及无桌面的 Linux 服务器

## 如何使用

CC Switch Web 在本地运行 Rust 服务，可在浏览器中管理 Claude、Claude Desktop、Codex、Gemini、Grok Build、OpenCode、OpenClaw、Hermes、Pi 和 MiniMax Code 等 AI 编码工具的供应商配置并一键切换。

当前 Web 分支已具备的能力：

- Claude、Claude Desktop、Codex、Gemini、Grok Build、OpenCode、OpenClaw、Hermes、Pi 和 MiniMax Code 的 Provider 管理
- MiniMax Code 的 Provider/模型（原生 `custom_provider`）、MCP、Skills、全局指令（`AGENTS.md`）、只读会话历史与用量导入；会话删除仍由 MiniMax Code 原生应用负责
- Pi 的 Provider、Prompts、Skills、Sessions 与 Usage；Pi `/login`、`auth.json`、默认 Provider/Model、代理、故障转移和 OAuth 托管明确由 Pi 原生管理
- Kimi Code、Antigravity、Oh My Pi、DeepSeek Harness 的 Provider、MCP、会话与用量导入；Antigravity 官方账号切换依赖 macOS 钥匙串，仅服务端为 macOS 时可用
- Claude、Codex、Gemini 的官方订阅额度展示
- ChatGPT（Codex OAuth）托管账号中心、Claude 预设与额度展示
- Claude → Codex 路由支持内置 WebSearch，Codex 路由支持 Alpha Search 透传
- 环境变量冲突检测与清理入口
- 通过 `?deeplink=...` 或手动输入 `ccswitch://...` 导入 Deep Link
- About 页面可直接打开 GitHub 最新发布页
- Provider、Settings、Skills、Sessions 已统一为工作台式界面

Pi 的配置所有权、同步规则、模型能力和界面约束见 [Pi 原生契约与实现边界](docs/pi-native-contract-zh.md) 及同目录的 Pi 专题文档。

### 快速运行

#### 方式一：Release 预编译包

1. 打开 [GitHub Releases](https://github.com/zuoliangyu/cc-switch-web/releases/latest)，按系统下载最新的预编译包：

   | 系统 | 下载文件 |
   | --- | --- |
   | Windows x64 | `cc-switch-web-windows-x64.zip` |
   | macOS（Intel / Apple Silicon） | `cc-switch-web-macos-universal.zip` |
   | Linux x64 | `cc-switch-web-linux-x64.tar.gz` |
   | Linux ARM64 | `cc-switch-web-linux-arm64.tar.gz` |

2. 解压，进入包含二进制的目录后直接运行：

   ```powershell
   # Windows
   .\cc-switch-web.exe
   ```

   ```bash
   # Linux/macOS
   chmod +x ./cc-switch-web
   ./cc-switch-web
   ```

   发布态下前端静态资源与 Web API 共用同一个端口，默认首选 `8890`。如端口被占用或无权限绑定，程序会自动尝试后续端口并输出最终监听地址。

3. 在浏览器打开终端输出的地址即可使用。需要 Docker、systemd 或源码构建时，参见下方「开发」一节。

4. 数据存放位置：本地 Web 服务模式下，Web 数据默认写入独立目录：

   ```text
   ~/.cc-switch-web
   ```

   其中包括 `settings.json`、`cc-switch.db`、备份目录以及统一 Skills 存储。首次启动且该目录不存在时，如果检测到 `~/.cc-switch/cc-switch.db`，会从中只读迁移；源数据库不会被 Web 修改。如果未检测到 CC Switch 数据库，则跳过迁移并初始化一套全新的 Web 数据。旧的 `config.json` 不再属于当前 Web 运行时的主数据路径。

#### 方式二：Docker

```bash
docker pull ghcr.io/zuoliangyu/cc-switch-web:latest
docker run -d --name cc-switch-web \
  -p 127.0.0.1:8890:8890 \
  -v cc-switch-web-data:/data \
  --restart unless-stopped \
  ghcr.io/zuoliangyu/cc-switch-web:latest
```

打开 [http://localhost:8890](http://localhost:8890) 即可使用，Web 数据会持久化在 `cc-switch-web-data` volume 中；新 volume 会直接初始化全新 Web 数据。当前 GHCR 运行镜像仅提供 `linux/amd64`，ARM64 请使用上方 Release 包。容器默认只管理 volume 内的数据；如需迁移 CC Switch 数据、管理宿主机上的 CLI 配置，或部署到局域网/公网，请参见下方「Docker 运行」「访问密钥」和「Linux systemd 示例」。

## 当前版本

当前仓库版本为 `3.0.0`。本次主版本升级引入关键字段配置写入与冲突处理、直连／路由／聚合模式、全局导航与账号中心，以及结构化会话阅读器、用量分析和资源管理。完整变更见 [CHANGELOG](CHANGELOG.md)。版本号与说明已更新，发布包和 Release 尚未发布。

尚未发布的改动已完成上游 `a189980f..a3eafa40`（v4.0.1–v4.0.25）的 Web 迁移：758 项提交中 559 项已迁移或适配、18 项部分迁移（均为有意保留的 Web 差异）、181 项不适用。新增 Kimi Code、Antigravity、Oh My Pi、DeepSeek Harness；界面向上游最终版收敛（供应商卡片、模式页签与面板、按模式的表单、设置分节目录、Skills 矩阵、分组预设选择器），Web 主题保持不变；用量页支持币种换算与自动汇率、全局筛选、成功率 / 速度 / 首字时间和侧栏今日数字。Windows 验证：前端 2585 项通过；Rust 3644 项通过、6 项忽略；零编译警告；已在隔离数据目录下完成桌面与窄屏浏览器验收。处置与验证见 [迁移台账](docs-dev/web-parity-post-a189980f-2026-11.md)，变更见 CHANGELOG 未发布段。

本版本完成上游 `f8788719..a189980f`（v4.0.0）适用内容的 Web 迁移。195 项提交中，176 项已迁移或按 Web 实现适配，19 项属于桌面、发行、文档布局或与 Web 约束不适用的内容。处置与验证记录见 [迁移台账](docs-dev/web-parity-post-f8788719-2026-10.md)。

升级注意：旧通用配置片段不再合并或整份回填；新请求不再应用费用倍率，历史金额保持原口径。供应商与预设统一按名称 A–Z 排序，移除手动拖拽排名和商业身份标识；故障转移队列保持原执行优先级。

Windows 验证：前端 1385 项通过、2 项原有跳过；Rust 2480 项通过、5 项原有忽略。TypeScript 与 Rust 全目标检查通过，Rust 编译零警告。本轮未运行发布构建、Docker、Linux/macOS 编译或真实账号联调。

全局侧栏提供 MCP、Skills、提示词、统一供应商、会话、用量、账号、应用及设置入口；展开不会挤压正文，手机使用抽屉。账号中心显示 Copilot、ChatGPT 和 xAI 的账号、额度及引用关系，删除前列出受影响供应商。托管 ChatGPT 模型可直接拉取；Copilot Enterprise 域名登录仍不支持。Hermes 记忆页为两个文件分别保留草稿。操作说明及 API 见 [全局页面与资源管理](docs/web-global-resources-guide-zh.md)。

Claude Code、Codex、Gemini、Grok Build 使用关键字段写入与三方冲突编辑器；切换保留全局设置，编辑全局字段保存后立即生效。旧通用片段不再合并或整份回填。Codex 配置、登录暂存、模型目录和账号标记共同提交；Gemini 双文件共同提交且不改 OAuth 文件；Grok 按写入记录清理旧模型表。Claude Desktop 使用独立 profile，仅修改网关字段。状态与首写备份位于 Web 数据目录（默认 `~/.cc-switch-web`）；JSON 首写可能规范化空白和转义，TOML/dotenv 保留未改部分的格式和注释。

浏览器支持直连、路由及 Claude/Codex 聚合。直连指针与代理默认路由独立，正常退出恢复客户端直连、下次启动恢复模式。Codex 官方路由保持原会话桶，支持压缩摘要回放、有界状态重试和目录刷新；Gemini 切换后提示重启。详见 [路由说明](docs/claude-codex-routing-guide-zh.md)。

用量页支持热力图、20 条分页、精确/估算速度和最近扫描时间；订阅额度显示剩余量、重置倒计时及刷新反馈，ChatGPT 显示保存的限额重置次数和到期日。新请求不再应用费用倍率，历史账单保持原口径；models.dev 默认自动同步价格，并保留已保存的关闭设置。

MCP 编辑器支持结构化字段、密文掩码和多服务器粘贴；MCP/Skills 批量开关只影响筛选结果并提供撤销，重新同步逐应用报告结果。Skills 展示逐仓库失败和 ZIP 跳过原因，区分自动/符号链接/复制同步，长列表按需渲染。提示词可复制为其他应用的独立未启用记录。

应用页支持九种 CLI 的安装/升级、来源冲突确认及跨页任务状态；操作作用于服务主机。会话阅读器支持九来源的结构化轮次、工具、Diff、按需图片/输出、全文检索、Markdown 下载及 Token/费用汇总。浏览器中的路径属于服务主机。

同步 88API、Tu-zi、Command Code 等预设与 GPT-6.1 Sol 定价。MiniMax Code 支持自选标识并拒绝覆盖重名；Pi 支持结构化模型编辑和能力补全。多应用模型参数按 API 地址匹配预设与 models.dev，只填空缺；OpenCode JSONC 编辑保留注释、未知字段并检测外部改动。

仓库以 `0.1.0` 作为 Web 分支的初始发布基线，此前继承的历史发布记录已移除，更早历史请以上游项目为准。

## 与上游项目的关系

- 上游项目：[cc-switch](https://github.com/farion1231/cc-switch)
- 当前 Web 仓库：[zuoliangyu/cc-switch-web](https://github.com/zuoliangyu/cc-switch-web)
- 作者：左岚（[哔哩哔哩](https://space.bilibili.com/27619688)）
- 当前仓库聚焦于 CC Switch 的 Web 分支方向
- 如需查看原始 CC Switch 项目或上游发布信息，请直接访问上游仓库
- 如果项目定位或对外描述发生变化，仓库内各语言版本 README 需要同步更新

## 开发

### 命令速查

| 场景 | 命令 |
| --- | --- |
| 交互菜单（汇总下列常用命令） | `.\menu.ps1` / `./menu.sh` |
| 本地开发（`w`） | `pnpm dev` |
| Docker 前台开发（`d`） | `pnpm dev -- d` |
| 本地 release 构建（`w`） | `pnpm build` |
| Docker 镜像构建（`d`） | `pnpm build -- d` |
| 项目检查 | `.\scripts\check.ps1` |
| 本地 CI 检查 | `.\scripts\ci-check.ps1` |
| Windows 本地导出产物 | `.\scripts\package-artifacts.ps1` |
| Docker 全量验证（检查/测试 + Linux 打包 + 镜像冒烟） | `pnpm verify:docker` |

脚本入口约定：

- `scripts/*.mjs` 负责跨平台主逻辑，供 `pnpm` 与 CI 直接调用
- `scripts/*.ps1` 负责 Windows 本地入口包装，便于 PowerShell 使用
- `scripts/lib/process.mjs` 与 `scripts/lib/entry.ps1` 分别承载 Node / PowerShell 的共享执行逻辑，避免重复维护
- 根目录 `menu.ps1` / `menu.sh` 以编号菜单汇总常用命令，也可直接传编号执行，例如 `./menu.sh 8`
- `pnpm verify:docker` 把源码复制进容器（不挂载宿主目录），用与 CI 相同的 Rust 1.88 / Node 20 以严格模式（警告即错误）依次执行 `pnpm check`、`vite build`、vitest、`cargo check`（Linux 原生 + Windows 交叉检查）、`cargo test`，再做 Linux x64/arm64 打包与镜像 `/api/health` 冒烟；可只跑 `verify`、`package` 或 `smoke`

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

### 从源码构建 Release 二进制

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

4. 在本地 Web 服务模式下，CC Switch Web 自身的数据默认写入独立目录：

   ```text
   ~/.cc-switch-web
   ```

   其中包括 `settings.json`、`cc-switch.db`、备份目录以及统一 Skills 存储等内容。首次启动且该目录不存在时，会从 `~/.cc-switch` 只读迁移；也可在「设置 → 数据」手动重新迁移，迁移前先备份 Web 数据。CC Switch 源数据库不会被 Web 修改。旧的 `config.json` 不再属于当前 Web 运行时的主数据路径。

### 访问密钥（可选）

通过 `CC_SWITCH_WEB_ACCESS_KEY` 可以保护 Web API。密钥至少需要 16 个字符；未设置或留空时保持原有的无认证模式。

```bash
CC_SWITCH_WEB_ACCESS_KEY='replace-with-a-long-random-key' ./backend/target/release/cc-switch-web
```

PowerShell：

```powershell
$env:CC_SWITCH_WEB_ACCESS_KEY='replace-with-a-long-random-key'; .\backend\target\release\cc-switch-web.exe
```

浏览器验证成功后仅在当前标签页的 `sessionStorage` 中保存密钥。局域网或公网部署时仍应使用 HTTPS 反向代理；访问密钥负责认证，不负责加密传输。

### Docker 运行

发布流水线会将 `linux/amd64` 运行镜像推送到 GitHub Container Registry：

```bash
docker pull ghcr.io/zuoliangyu/cc-switch-web:latest
docker run -d --name cc-switch-web \
  -p 8890:8890 \
  -e CC_SWITCH_WEB_ACCESS_KEY='replace-with-a-long-random-key' \
  -v cc-switch-web-data:/data \
  ghcr.io/zuoliangyu/cc-switch-web:latest
```

版本 tag 还会发布对应的 `vX.Y.Z`、`X.Y.Z` 和 `X.Y` 镜像标签。当前 Registry 运行镜像仅提供 `linux/amd64`；arm64 仍使用下文的独立静态二进制包。

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

   通过 Compose 启用访问密钥：

   ```bash
   CC_SWITCH_WEB_ACCESS_KEY='replace-with-a-long-random-key' docker compose up -d
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

   当前示例文件主要面向 Linux 服务器，默认使用 `$HOME` 下的 `.claude`、`.codex`、`.gemini`、`.config/opencode`、`.config/openclaw` 目录。如需首次启动或手动迁移 CC Switch 数据，请取消注释 `${HOME}/.cc-switch:/data/.cc-switch:ro`；迁移来源在容器内仍为只读。

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

#### ARM / 嵌入式开发板

如果目标是 64 位 ARM 开发板（aarch64 / arm64，如树莓派 3/4/5 的 64 位系统、
RK35xx、各类 Allwinner 板等），用单独的 `Dockerfile.arm64`
（`messense/rust-musl-cross` 在 amd64 主机交叉编译，不走 QEMU，几分钟即可，
无需 binfmt），不要传 `--platform`：

```bash
docker buildx build -f Dockerfile.arm64 --target package-linux-tar \
  --output type=local,dest=release/docker-linux .
# -> release/docker-linux/cc-switch-web-linux-arm64.tar.gz
```

打 `v*` tag 触发的 Web Package 发布流水线会自动产出
`linux-x64` / `linux-arm64` 两份 `tar.gz`。

> 32 位 armv7 暂不提供：直接依赖 `rquickjs-sys` 未为
> `armv7-unknown-linux-musleabihf` 预置 FFI 绑定，交叉编译需额外的
> bindgen/libclang 链路，暂未纳入发布矩阵。

当前导出的 Linux 二进制均为静态链接（musl）版本——x64 为
`x86_64-unknown-linux-musl`，arm64 为 `aarch64-unknown-linux-musl`，
可尽量减少宿主机运行库差异导致的问题。

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
