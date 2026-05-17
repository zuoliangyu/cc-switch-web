# CC Switch Web

[中文](README.md) | English | [日本語](README_JA.md)

## Overview

CC Switch Web is the web branch repository of [cc-switch](https://github.com/farion1231/cc-switch), carrying the web-oriented implementation and branch-specific customizations of CC Switch.

Architecture and positioning:

- Frontend: Web
- Backend: local Rust service
- Access pattern: browser opens `http://localhost:xxxx`
- Targets: Windows, macOS, Linux, and headless Linux servers

## Usage

CC Switch Web runs a local Rust service so you can manage and one-click switch provider configurations for multiple AI coding tools — Claude, Codex, Gemini, OpenClaw, and more — from your browser.

Capabilities already available on the Web branch:

- Provider form model fetching for Claude, Codex, Gemini, and OpenClaw
- Official subscription quota display for Claude, Codex, and Gemini
- Managed ChatGPT (Codex OAuth) account center, Claude preset, and quota display
- Environment variable conflict detection and cleanup entry points
- Deep link import via `?deeplink=...` or manual `ccswitch://...` input
- About page entry to open the latest GitHub release page
- Workspace-style UI for Provider, Settings, Skills, and Sessions pages

### Quick Start

1. Build the release binary with embedded frontend assets:

   ```bash
   pnpm install --frozen-lockfile
   pnpm build
   ```

   (Rust `1.88+` required; see the "Development" section below for detailed build/dev options.)

2. Run the binary, then open the final address printed in the terminal:

   ```bash
   # Linux/macOS
   ./backend/target/release/cc-switch-web --backend-port 8890
   ```

   ```powershell
   # Windows
   .\backend\target\release\cc-switch-web.exe -b 8890
   ```

   In release mode the frontend static assets and Web API share the same port, with `8890` as the default preferred port. If the port is occupied or denied, the service automatically scans forward and prints the actual port it bound to.

3. Open the address printed in the terminal in your browser, and you're ready.

4. Data location: in local Web service mode, data is stored under the default CC Switch local config root:

   ```text
   ~/.cc-switch
   ```

   This includes `settings.json`, `cc-switch.db`, backup data, and the unified Skills storage. Legacy `config.json` is not part of the active Web runtime data path.

> To run via Docker or keep it hosted on a headless server, see "Docker" and "Linux systemd Example" under "Development" below.

## Version

The current repository version is `0.5.1`. For per-version change details, the per-fix upstream commit references, and items deferred to follow-up tasks, see `CHANGELOG.md` and `docs-dev/web-parity-post-3.14-2026-05.md`.

This repository treats `0.1.0` as its initial Web release baseline; previous inherited release history has been removed and should be considered part of the upstream project history.

## Relationship to Upstream

- Upstream project: [cc-switch](https://github.com/farion1231/cc-switch)
- Current Web repository: [zuoliangyu/zuoliangyu-cc-switch-web](https://github.com/zuoliangyu/zuoliangyu-cc-switch-web)
- Author: 左岚 ([Bilibili](https://space.bilibili.com/27619688))
- This repository focuses on the Web branch direction of CC Switch
- If you are looking for the original CC Switch project or upstream release information, please visit the upstream repository directly
- When project positioning or external description changes, all language README files in this repository should be updated together

## Development

### Quick Commands

| Scenario | Command |
| --- | --- |
| Local development (`w`) | `pnpm dev` |
| Docker foreground development (`d`) | `pnpm dev -- d` |
| Local release build (`w`) | `pnpm build` |
| Docker image build (`d`) | `pnpm build -- d` |
| Project check | `.\scripts\check.ps1` |
| Local CI check | `.\scripts\ci-check.ps1` |
| Export artifacts on Windows | `.\scripts\package-artifacts.ps1` |

Script entry layout:

- `scripts/*.mjs` contains the cross-platform main logic used directly by `pnpm` and CI
- `scripts/*.ps1` provides thin Windows-local wrappers for PowerShell usage
- `scripts/lib/process.mjs` and `scripts/lib/entry.ps1` hold the shared Node / PowerShell execution helpers to avoid duplicated scripting logic

### Local Development

1. Install dependencies:

   ```bash
   pnpm install --frozen-lockfile
   ```

   Rust `1.88+` is required for the backend build and check steps.

2. Start development mode:

   ```bash
   pnpm dev
   ```

   Equivalent explicit form:

   ```bash
   pnpm dev -- w
   ```

   On Windows, you can also run:

   ```powershell
   .\scripts\dev.ps1 w
   ```

   To pin ports explicitly, you can run:

   ```bash
   pnpm dev -- --frontend-port 3300 --backend-port 8890
   pnpm dev -- w -f 3300 -b 8890 --host 127.0.0.1
   ```

   On Windows:

   ```powershell
   .\scripts\dev.ps1 w -f 3300 -b 8890
   ```

3. Open [http://localhost:3000](http://localhost:3000). The frontend connects to the local Rust service at `http://127.0.0.1:8890`.
   In local development, open the frontend dev URL instead of the backend port. `pnpm dev` disables backend static frontend hosting by default, and when a preferred port is unavailable it automatically scans forward and wires the final backend address into Vite.

4. `pnpm dev` enables local request debug logs by default:
   - Browser DevTools show frontend request/response logs
   - The Rust service terminal shows Web API method/path/status/duration logs
   - You can override this with `VITE_RUNTIME_DEBUG_REQUESTS=0|1` and `CC_SWITCH_WEB_DEBUG_API=0|1`

### Local Release Binary

1. Build the embedded release binary:

   ```bash
   pnpm build
   ```

   Equivalent explicit form:

   ```bash
   pnpm build -- w
   ```

   On Windows, you can also run:

   ```powershell
   .\scripts\build.ps1 w
   ```

2. Output path:

   - Windows: `backend\target\release\cc-switch-web.exe`
   - Linux/macOS: `backend/target/release/cc-switch-web`

3. Run the binary directly, then open the final address printed in the terminal. The frontend static assets and Web API share the same service port. The default preferred port is `8890`:

   ```bash
   ./backend/target/release/cc-switch-web --backend-port 8890
   ```

   Windows:

   ```powershell
   .\backend\target\release\cc-switch-web.exe -b 8890
   ```

   If the preferred port is already in use, excluded by the OS, or denied by local policy, the service automatically scans forward and prints the actual port it bound to.

4. In local Web service mode, CC Switch Web stores its own data under the default CC Switch local config root:

   ```text
   ~/.cc-switch
   ```

   This includes files such as `settings.json`, `cc-switch.db`, backup data, and the unified Skills storage. Legacy `config.json` is not part of the active Web runtime data path.

### Docker

1. Build the Docker image:

   ```bash
   pnpm build -- d
   ```

   On Windows, you can also run:

   ```powershell
   .\scripts\build.ps1 d
   ```

2. Run the Docker stack in the foreground:

   ```bash
   pnpm dev -- d
   ```

   On Windows, you can also run:

   ```powershell
   .\scripts\dev.ps1 d
   ```

   To override the exposed service port:

   ```bash
   CC_SWITCH_WEB_PORT=8895 pnpm dev -- d
   ```

   PowerShell:

   ```powershell
   $env:CC_SWITCH_WEB_PORT=8895; .\scripts\dev.ps1 d
   ```

3. If you want background mode after the image is built, use Docker directly:

   ```bash
   docker compose up -d
   docker compose logs -f
   docker compose down
   ```

4. Open [http://localhost:8890](http://localhost:8890) or your overridden port. The container serves the embedded frontend and API on the same port. Docker mode keeps `CC_SWITCH_WEB_PORT_SCAN_COUNT=1` by default so that published port mappings stay stable. Persistent data is stored in the `cc-switch-web-data` volume.

5. If you want the containerized service to manage host-side CLI config directories directly, first copy the example file:

   ```bash
   cp docker-compose.host.example.yml docker-compose.host.yml
   ```

   Then adjust the paths for your machine and run:

   ```bash
   docker compose -f docker-compose.yml -f docker-compose.host.yml up -d
   ```

   The example file is primarily for Linux servers and uses `$HOME` paths for `.claude`, `.codex`, `.gemini`, `.config/opencode`, and `.config/openclaw`.

### Export Linux Package Inside Docker

If you want a Linux release package without polluting the host build environment, use Docker Buildx directly:

```bash
docker buildx build --target package-linux-tar --output type=local,dest=release/docker-linux .
```

Exported archive:

```text
release/docker-linux/cc-switch-web-linux-x64.tar.gz
```

If you want the unpacked directory instead:

```bash
docker buildx build --target package-linux-dir --output type=local,dest=release/docker-linux .
```

Exported directory:

```text
release/docker-linux/cc-switch-web-linux-x64/
```

The package contains the single executable `cc-switch-web`. After extracting on Linux, run that binary directly.

The exported Linux binary is built as `x86_64-unknown-linux-musl`, which reduces host-side runtime dependency issues.

### Export Artifacts On Windows

If you are working on Windows and already have Rust plus Docker/Buildx installed locally, run:

```powershell
.\scripts\package-artifacts.ps1
```

If you only want the project static checks on Windows, use:

```powershell
.\scripts\check.ps1
```

It only runs the existing Node script validation, TypeScript check, and Rust check. It does not trigger any Docker build.

If you want to reproduce the full CI check flow locally on Windows, use:

```powershell
.\scripts\ci-check.ps1
```

That runs the static checks first, then the same Docker smoke check used in CI: `docker build` + container startup + `GET /api/health`. If port `8890` is already occupied, override it with:

```powershell
.\scripts\ci-check.ps1 -DockerSmokePort 8895
```

If you prefer the npm script for static checks, you can still run:

```powershell
pnpm check
```

The Windows export script now directly produces the local release-equivalent artifact set:

- Windows executable: `release\local-artifacts\windows\cc-switch-web.exe`
- Linux release package: `release\local-artifacts\linux\cc-switch-web-linux-x64.tar.gz`
- Docker image archive: `release\local-artifacts\docker\cc-switch-web-docker-image.tar.gz`

Details:

- The Windows artifact comes from local `cargo build --locked --release`
- The Linux artifact comes from Docker Buildx using the `package-linux-tar` stage
- The Docker image archive can be imported with:

```powershell
docker load -i .\release\local-artifacts\docker\cc-switch-web-docker-image.tar.gz
```

### Linux systemd Example

If you want to keep the service running on a headless Linux server, use:

`deploy/systemd/cc-switch-web.service.example`

Recommended steps:

1. Build the release binary on Linux, or copy a packaged Linux artifact into `/opt/cc-switch-web`.

2. Copy the service file into the system directory:

   ```bash
   sudo cp deploy/systemd/cc-switch-web.service.example /etc/systemd/system/cc-switch-web.service
   ```

3. Adjust these fields for your machine:
   - `User`
   - `Group`
   - `WorkingDirectory`
   - `HOME`
   - `ExecStart`

4. Reload and start:

   ```bash
   sudo systemctl daemon-reload
   sudo systemctl enable --now cc-switch-web
   ```

5. Check status and logs:

   ```bash
   sudo systemctl status cc-switch-web
   sudo journalctl -u cc-switch-web -f
   ```
