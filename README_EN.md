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

CC Switch Web runs a local Rust service so you can manage and one-click switch provider configurations for Claude, Claude Desktop, Codex, Gemini, Grok Build, OpenCode, OpenClaw, Hermes, Pi, and other AI coding tools from your browser.

Capabilities already available on the Web branch:

- Provider management for Claude, Claude Desktop, Codex, Gemini, Grok Build, OpenCode, OpenClaw, Hermes, and Pi
- Pi Provider, Prompts, Skills, Sessions, and Usage support; Pi keeps ownership of `/login`, `auth.json`, the default Provider/Model, proxying, failover, and managed OAuth
- Official subscription quota display for Claude, Codex, and Gemini
- Managed ChatGPT (Codex OAuth) account center, Claude preset, and quota display
- Built-in WebSearch for Claude-to-Codex routing and Alpha Search passthrough for Codex routes
- Environment variable conflict detection and cleanup entry points
- Deep link import via `?deeplink=...` or manual `ccswitch://...` input
- About page entry to open the latest GitHub release page
- Workspace-style UI for Provider, Settings, Skills, and Sessions pages

See [Pi Native Contract and Implementation Boundaries](docs/pi-native-contract-zh.md) and the other Pi documents in the same directory for configuration ownership, synchronization, model capabilities, and UI constraints.

### Quick Start

#### Option 1: Prebuilt Release

1. Open [GitHub Releases](https://github.com/zuoliangyu/cc-switch-web/releases/latest) and download the latest prebuilt package for your system:

   | System | Download |
   | --- | --- |
   | Windows x64 | `cc-switch-web-windows-x64.zip` |
   | macOS (Intel / Apple Silicon) | `cc-switch-web-macos-universal.zip` |
   | Linux x64 | `cc-switch-web-linux-x64.tar.gz` |
   | Linux ARM64 | `cc-switch-web-linux-arm64.tar.gz` |

2. Extract the archive, enter the directory containing the binary, and run it directly:

   ```powershell
   # Windows
   .\cc-switch-web.exe
   ```

   ```bash
   # Linux/macOS
   chmod +x ./cc-switch-web
   ./cc-switch-web
   ```

   In release mode the frontend static assets and Web API share the same port, with `8890` as the default preferred port. If the port is occupied or denied, the service automatically scans forward and prints the actual port it bound to.

3. Open the address printed in the terminal in your browser. For Docker, systemd, or source builds, see "Development" below.

4. Data location: in local Web service mode, Web data is stored in its own directory:

   ```text
   ~/.cc-switch-web
   ```

   This includes `settings.json`, `cc-switch.db`, backup data, and unified Skills storage. On first startup, if this directory does not exist and `~/.cc-switch/cc-switch.db` is found, it is migrated read-only; the source database is never modified by Web. If no CC Switch database is found, migration is skipped and a fresh Web data store is initialized. Legacy `config.json` is not part of the active Web runtime data path.

#### Option 2: Docker

```bash
docker pull ghcr.io/zuoliangyu/cc-switch-web:latest
docker run -d --name cc-switch-web \
  -p 127.0.0.1:8890:8890 \
  -v cc-switch-web-data:/data \
  --restart unless-stopped \
  ghcr.io/zuoliangyu/cc-switch-web:latest
```

Open [http://localhost:8890](http://localhost:8890). Web data persists in the `cc-switch-web-data` volume; a new volume initializes a fresh Web data store. The current GHCR runtime image supports `linux/amd64` only; use the Release package on ARM64. By default, the container manages only data inside that volume. To migrate CC Switch data, manage host CLI configuration, or deploy on a LAN/public network, see "Docker", "Access Key", and "Linux systemd Example" below.

## Version

The current repository version is `2.1.0`. This release adds the latest upstream Provider and reasoning capabilities, Codex OAuth lifecycle handling, Hosted WebSearch, and secure native Windows CLI detection, while fixing third-party Provider session migration and full-suite test stability. See `CHANGELOG.md` and `docs-dev/web-parity-post-40cac1a6-2026-08.md` for release details and the upstream migration ledger.

This repository treats `0.1.0` as its initial Web release baseline; previous inherited release history has been removed and should be considered part of the upstream project history.

## Relationship to Upstream

- Upstream project: [cc-switch](https://github.com/farion1231/cc-switch)
- Current Web repository: [zuoliangyu/cc-switch-web](https://github.com/zuoliangyu/cc-switch-web)
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

### Build a Release Binary from Source

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

4. In local Web service mode, CC Switch Web stores its own data in a separate directory:

   ```text
   ~/.cc-switch-web
   ```

   This includes files such as `settings.json`, `cc-switch.db`, backup data, and unified Skills storage. On first startup, if this directory does not exist, data is migrated read-only from `~/.cc-switch`. Settings also provides a manual re-migration action that backs up Web data first. Web never modifies the CC Switch source database. Legacy `config.json` is not part of the active Web runtime data path.

### Access Key (Optional)

Set `CC_SWITCH_WEB_ACCESS_KEY` to protect the Web API. The key must contain at least 16 characters. Leaving it unset or empty preserves the existing unauthenticated mode.

```bash
CC_SWITCH_WEB_ACCESS_KEY='replace-with-a-long-random-key' ./backend/target/release/cc-switch-web
```

PowerShell:

```powershell
$env:CC_SWITCH_WEB_ACCESS_KEY='replace-with-a-long-random-key'; .\backend\target\release\cc-switch-web.exe
```

After verification, the browser stores the key only in the current tab's `sessionStorage`. LAN or Internet deployments should still use an HTTPS reverse proxy: the access key provides authentication, not transport encryption.

### Docker

The release workflow publishes the `linux/amd64` runtime image to GitHub Container Registry:

```bash
docker pull ghcr.io/zuoliangyu/cc-switch-web:latest
docker run -d --name cc-switch-web \
  -p 8890:8890 \
  -e CC_SWITCH_WEB_ACCESS_KEY='replace-with-a-long-random-key' \
  -v cc-switch-web-data:/data \
  ghcr.io/zuoliangyu/cc-switch-web:latest
```

Version tags also publish matching `vX.Y.Z`, `X.Y.Z`, and `X.Y` image tags. The Registry runtime image currently targets `linux/amd64`; arm64 remains available as the standalone static binary package described below.

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

   To enable the access key with Compose:

   ```bash
   CC_SWITCH_WEB_ACCESS_KEY='replace-with-a-long-random-key' docker compose up -d
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

   The example file is primarily for Linux servers and uses `$HOME` paths for `.claude`, `.codex`, `.gemini`, `.config/opencode`, and `.config/openclaw`. To enable automatic or manual CC Switch migration, uncomment `${HOME}/.cc-switch:/data/.cc-switch:ro`; the migration source remains read-only inside the container.

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
