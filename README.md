# CC Switch Web

中文 | [English](README_EN.md) | [日本語](README_JA.md)

## 项目说明

CC Switch Web 是 [cc-switch](https://github.com/farion1231/cc-switch) 的 Web 分支仓库，用于承载 CC Switch 的 Web 方向实现与分支定制。

架构与定位：

- 前端：Web
- 后端：本地 Rust 服务
- 访问方式：浏览器访问 `http://localhost:xxxx`
- 适用场景：Windows、macOS、Linux，以及无桌面的 Linux 服务器

## 如何使用

CC Switch Web 在本地跑一个 Rust 服务，你在浏览器里管理 Claude、Codex、Gemini、OpenClaw 等多个 AI 编码工具的供应商配置，一键切换。

当前 Web 分支已具备的能力：

- Claude、Codex、Gemini、OpenClaw 的供应商模型拉取
- Claude、Codex、Gemini 的官方订阅额度展示
- ChatGPT（Codex OAuth）托管账号中心、Claude 预设与额度展示
- 环境变量冲突检测与清理入口
- 通过 `?deeplink=...` 或手动输入 `ccswitch://...` 导入 Deep Link
- About 页面可直接打开 GitHub 最新发布页
- Provider、Settings、Skills、Sessions 已统一为工作台式界面

### 快速运行

1. 构建嵌入前端资源的 release 二进制：

   ```bash
   pnpm install --frozen-lockfile
   pnpm build
   ```

   （需要 Rust `1.88+`；详细构建/开发选项见下方「开发」一节）

2. 运行二进制，然后打开终端中打印出的最终地址：

   ```bash
   # Linux/macOS
   ./backend/target/release/cc-switch-web --backend-port 8890
   ```

   ```powershell
   # Windows
   .\backend\target\release\cc-switch-web.exe -b 8890
   ```

   发布态下前端静态资源与 Web API 共用同一个端口，默认首选 `8890`。如端口被占用或无权限绑定，程序会自动尝试后续端口并输出最终监听地址。

3. 在浏览器打开终端输出的地址即可使用。

4. 数据存放位置：本地 Web 服务模式下，数据默认写入 CC Switch 的本地配置根目录：

   ```text
   ~/.cc-switch
   ```

   其中包括 `settings.json`、`cc-switch.db`、备份目录以及统一 Skills 存储。旧的 `config.json` 不再属于当前 Web 运行时的主数据路径。

> 想用 Docker 跑、或在无桌面服务器上长期托管，见下方「开发」中的 Docker 运行与 Linux systemd 示例。

## 当前版本

当前仓库版本为 `0.5.1`。逐版变更明细、每条修复对应的上游 commit、被延后到独立任务的项，见 `CHANGELOG.md` 与 `docs-dev/web-parity-post-3.14-2026-05.md`。

仓库以 `0.1.0` 作为 Web 分支的初始发布基线，此前继承的历史发布记录已移除，更早历史请以上游项目为准。

## 与上游项目的关系

- 上游项目：[cc-switch](https://github.com/farion1231/cc-switch)
- 当前 Web 仓库：[zuoliangyu/zuoliangyu-cc-switch-web](https://github.com/zuoliangyu/zuoliangyu-cc-switch-web)
- 作者：左岚（[哔哩哔哩](https://space.bilibili.com/27619688)）
- 当前仓库聚焦于 CC Switch 的 Web 分支方向
- 如需查看原始 CC Switch 项目或上游发布信息，请直接访问上游仓库
- 如果项目定位或对外描述发生变化，仓库内各语言版本 README 需要同步更新

## 开发

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
