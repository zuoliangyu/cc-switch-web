# CC Switch Web

[中文](README.md) | English | [日本語](README_JA.md)

## Overview

CC Switch Web is the web branch repository of [cc-switch](https://github.com/farion1231/cc-switch).

This repository is used to carry web-oriented work around CC Switch, including web-side implementation, related experiments, and branch-specific adjustments.

The current target architecture is:

- Frontend: Web
- Backend: local Rust service
- Access pattern: browser opens `http://localhost:xxxx`

This direction targets Windows, macOS, Linux, and headless Linux server environments.

## Version

The current repository version is `0.5.0`.

`0.5.0` is a routine dependency-bump + test-fixture repair release:

- Fixes the `OpenClaw delete_session_updates_index_and_removes_jsonl` test fixture: on Windows, temp paths contain backslashes that `serde_json::from_str` rejects as invalid escapes (`\T`, `\U`, etc.). The fixture now builds the index via `serde_json::json!` and lets serde handle escaping. Backend `cargo test` now reports 775/775 with zero pre-existing failures.
- Frontend dependencies are bumped within minor / patch range (`@tanstack/react-query`, `@codemirror/*`, `framer-motion`, `i18next` / `react-i18next`, `prettier`, `vite 7.3.x`, `tailwindcss 3.4.x`, etc., 24 packages total). Deliberately skipped `react` 18→19, `tailwindcss` 3→4, `vite` 7→8, `typescript` 5→6, `vitest` 2→4 — these have known breaking changes and will be addressed in dedicated iterations.

`0.4.0` lands the largest deferred item from the 0.3.x line — B1 cross-source usage deduplication.

**Background**: proxy live writes and session-log sync used different `request_id` generation rules. Only Claude on the native Anthropic backend shared the `session:{message_id}` key; Codex / Gemini / Claude-through-OpenAI compat paths always produced distinct ids, so primary-key dedup never fired and every real request was recorded twice — dashboard totals were doubled.

**Fix**:

- `TokenUsage` gains a `message_id` field and a `dedup_request_id()` method (extracted from Claude `body.id` / `message_start.message.id`); proxy writes and session-log sync now share the `session:{msg_xxx}` primary key so primary-key dedup actually works.
- The proxy logger switches to `INSERT OR REPLACE`: when both paths collide on the same key, the richer data wins.
- SQL-layer 7-dim fingerprint dedup filter: `(app_type, 4 token counts, 2xx status, case-insensitive model, created_at ± 10min window)`, covering Codex / Gemini / Claude-through-OpenAI paths where the request_id can't be shared.
- The filter is applied at all three layers: read (summary/provider/model/logs/limits), write (`should_skip_session_insert` before INSERT in all three `session_usage_*.rs`), and rollup (`usage_daily_rollups` no longer absorbs session_log duplicates).
- Minor bump to 0.4.0 because `TokenUsage` is `pub` and adding `message_id` is an ABI change.

This closes out all B1 / C7 / F1 items deferred from 0.3.x. See `CHANGELOG.md` and `docs-dev/web-parity-post-3.14-2026-05.md` for the per-fix upstream commit references.

`0.3.2` follows up on the two items deferred in `0.3.1`:

- Codex provider-switch history stability (upstream `a1e6c3b6`): after switching Codex providers via CC Switch, `codex resume` previously appeared to "lose" history because Codex filters resume sessions by `model_provider`, and the old behavior let that field drift between custom ids like `rightcode` and `aihubmix`. This release introduces a stable provider-id normalization at provider-driven write boundaries (prefer reusing an existing custom id, otherwise fall back to `ccswitch`), and rewrites matching `[profiles.*]` references in lockstep. Backfill paths reverse the normalization back to the stored template's original id to avoid contaminating it. Comes with 8 new unit tests covering both normalization and backfill restoration.
- Usage perf (the parts of upstream `f061b777` not reverted by `518d945e`): a new `(app_type, created_at DESC)` covering index for dashboard range queries; default pricing seeds for GPT-5.4 (3 entries) and GPT-5.5 (6 entries), which combine with the 0.3.1 case-insensitive `find_model_pricing_row` fix to further eliminate dashboard ghost-zero-cost rows.

`0.3.1` ports a curated batch of fixes accumulated upstream since the `0.3.0` release, filtered for "direct value to the Web backend":

- Proxy streaming: dedupe duplicate `finish_reason` chunks and defer `message_delta` until `[DONE]` (fixes OpenRouter / Kimi-K2.6 emitting multiple finish reasons and aborting Anthropic clients); preserve full Cloudflare AI Gateway Vertex AI URLs; keep `reasoning_content` on Kimi/Moonshot tool-call paths; harden DashScope / Codex OAuth `usage` parsing against null and partial fields.
- Auth semantics: `ANTHROPIC_AUTH_TOKEN` → `Authorization: Bearer`, `ANTHROPIC_API_KEY` → `x-api-key`, matching the Anthropic SDK; stream check now reuses the same header logic and no longer emits both, removing health-check false negatives.
- Providers: DeepSeek / Kimi / Zhipu GLM / MiniMax (Anthropic-compat on a subpath but `/models` at the root) can now fetch model lists via candidate ordering `/anthropic/v1/models` → `/v1/models` → `/models`; GitHub Copilot dash-form Claude ids (`claude-sonnet-4-6[1m]`) get normalized to dot form and resolved against the live `/models` list with family fallback; SiliconFlow international site shows USD; Zhipu weekly tier label fixed.
- Sessions: Codex explorer / sub-agent sessions are hidden from the main list; summary extraction skips `<environment_context>` injections.
- Config: `settings.json` keys are written in alphabetical order so config switches no longer churn diffs; MCP imports no longer write back to live app configs.
- Windows: when JSON config contains whitelisted `%USERPROFILE%`-style placeholders, the editor offers a one-click "expand to absolute paths" action (Claude Code does not auto-expand Windows env vars); non-Windows `try_get_version` now prefers `$SHELL` to load the user's PATH/alias.
- Claude effort toggle: `effortHigh` now writes `env.CLAUDE_CODE_EFFORT_LEVEL` (the legacy top-level `effortLevel` field is not honored by Claude Code); reading still falls back to the legacy field for migration.
- Usage robustness: `find_model_pricing_row` is case-insensitive, fixing "ghost zero-cost" rows for model ids like `OpenAI/GPT-5.5@HIGH`; new 7-column covering index `idx_request_logs_dedup_lookup` lays the groundwork for full dedup work coming later.

See `CHANGELOG.md` and `docs-dev/web-parity-post-3.14-2026-05.md` for the per-fix upstream commit references and the items deferred to follow-up tasks (B1 full 7-dim fingerprint dedup / C7 Codex provider-switch history stability / F1 startup cost backfill).

This repository now treats `0.1.0` as its initial Web release baseline. Previous inherited release history has been removed from this repository and should be considered part of the upstream project history.

## Relationship to Upstream

- Upstream project: [cc-switch](https://github.com/farion1231/cc-switch)
- Current Web repository: [zuoliangyu/zuoliangyu-cc-switch-web](https://github.com/zuoliangyu/zuoliangyu-cc-switch-web)
- Author: 左岚 ([Bilibili](https://space.bilibili.com/27619688))
- This repository focuses on the Web branch direction of CC Switch
- When project positioning or external description changes, all language README files in this repository should be updated together

## Notes

If you are looking for the original CC Switch project or upstream release information, please visit the upstream repository directly.

## Recent Web Alignment And UI Refresh

The current Web branch has aligned the following desktop-side capabilities and completed a new round of Web UI refresh:

- Provider form model fetching for Claude, Codex, Gemini, and OpenClaw
- Official subscription quota display for Claude, Codex, and Gemini
- Managed ChatGPT (Codex OAuth) account center, Claude preset, and quota display
- Environment variable conflict detection and cleanup entry points
- Deep link import via `?deeplink=...` or manual `ccswitch://...` input
- About page entry to open the latest GitHub release page
- Refreshed workspace-style UI hierarchy for Provider, Settings, Skills, and Sessions pages
- Refreshed related full-screen panels, repository management panel, and session TOC panel to match the new Web visual language

## Run

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
