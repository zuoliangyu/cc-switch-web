# Web Parity — Claude Desktop 子系统移植实施计划

> 状态：**计划草案，待审阅**。本文件只描述方案，未改任何代码。
> 对应上游：cc-switch `5bbd83f7~1 .. c460a404`（claude-desktop 全量，19 提交 / 98 文件 / +8544 −2315）。

## 1. 背景与关键发现

cc-switch 新增的 "Claude Desktop" 是一个**第三方推理目标**：CC Switch 把 provider 写进 Claude Desktop 的 `configLibrary/` 三方推理 profile，并提供两种模式——

- **direct**：provider 本身在 Anthropic Messages 上暴露 `claude-*` / `anthropic/claude-*` 模型 id，Claude Desktop 直连。
- **proxy**：CC Switch 本地代理充当推理网关，对 Claude Desktop 只暴露 `claude-*` 路由名，内部映射到真实上游模型（Anthropic 限制 Claude Desktop 只接受 claude 家族 id 后必需）。

**架构错配比初判轻**：web 的 `backend/src/proxy/` 与 cc-switch `src-tauri/src/proxy/` 是同源 fork，同名文件全在（forwarder / provider_router / model_mapper / handlers / circuit_breaker / providers/{claude,codex,gemini,transform,…}），且 web 已多出 `codex_oauth_auth.rs` / `copilot_auth.rs` / `copilot_model_map.rs`。所以这不是"从零重写"，而是**在已有 proxy 上新增模块 + 应用目标 + 网关路由 + 前端表单**，并把若干 proxy 增量做三方合并。

**运行时差异**：cc-switch 走 Tauri command（前端 `invoke`）；web 走 Axum HTTP（`backend/src/web_server.rs` 注册 `/api/...`，前端走 `src/lib/api` hooks）。命令体逻辑可复用，**绑定层需重写**。

## 2. 组件清单与 web 落点

| cc-switch 来源 | 内容 | web 落点 | 适配难度 |
|---|---|---|---|
| `src-tauri/src/claude_desktop_config.rs`（**1561 行**，最大单模块） | snapshot/rollback、官方 seed bypass、默认代理路由唯一来源、模型 id 映射（`supports_1m`）、网关 token、direct/proxy 校验、`model_list_response`、`map_proxy_request_model` | 新增 `backend/src/claude_desktop_config.rs` | 中——逻辑以 DB + JSON + 字符串映射为主，非 Tauri 耦合；`AppError`/`Database` web 有等价物 |
| `commands/proxy.rs` 增量、`commands/codex_oauth.rs` 增量 | `get_claude_desktop_status`、网关启停、OAuth 供应商校验放开 | web `backend/src/commands/proxy.rs` / `codex_oauth.rs` + `web_server.rs` 注册 `/api/...` | 中——命令体可移植，绑定改 HTTP handler |
| `/claude-desktop/v1/{models,messages}` 网关路由 | Claude Desktop 入站网关（token 校验、模型路由、转发到既有 proxy forwarder） | `web_server.rs` 新增路由 + 复用 `backend/src/proxy` forwarder | 中高——需接入 web proxy 入站链路 |
| `proxy/` 增量（8b3ad9ca / 6a3c2fe0 / 84bac6dc / 953b7cdc / 60a36283 等对 forwarder/provider_router/model_mapper/handlers/providers 的改动） | 代理网关模式、Copilot/Codex OAuth 供应商、路由 schema（去 displayName、`[1M]`→`supports1m`）、route id 锁 sonnet/opus/haiku | web `backend/src/proxy/*` 三方合并 | **高**——web proxy 已与 cc-switch 偏离（`mod.rs` 34↔58、`provider_router` 479↔523、`model_mapper` 345↔312），需逐文件 3-way merge |
| `database/dao/proxy.rs`、`database/mod.rs` 增量 | 网关 token 持久化、schema 迁移 | web `backend/src/database/*` | 中——需新增迁移，注意 web schema 版本线 |
| `src/lib/api/types.ts` `AppId` 联合、`backend/src/app_config.rs` `AppType`（:301）、`APP_IDS`、`appConfig.tsx` | 新增 `claude-desktop` 应用目标 | 同名处扩展 | 低——机械扩展，但牵连面广（很多 `Record<AppId,…>` 需补全，tsc 会全量报出） |
| `src/components/AppSwitcher.tsx` | Claude Code vs Claude Desktop 区分、空 toolbar 隐藏 | web `AppSwitcher.tsx`（需确认 web 是否有同名/等价组件） | 中 |
| `src/components/providers/forms/ClaudeDesktopProviderForm.tsx` | 独立精简表单、appId guard、状态 banner（5s 轮询）、路由开关 | web `src/components/providers/forms/`（web 有 ProviderForm 体系；C 类此前已知 web 无此表单） | 中高——依赖 web hooks/api 而非 Tauri invoke，需重建数据层 |
| `src/config/claudeDesktopProviderPresets.ts` + 44 预设 + 后续 4eb5543d/c460a404/6a3c2fe0 调整 | 预设数据 | web `src/config/claudeDesktopProviderPresets.ts` | 低——纯数据，但依赖前述 schema/类型先就位 |
| i18n zh/en/ja 增量 | claude-desktop 文案 | web `src/i18n/locales/*` | 低 |
| `tray.rs` / `tauri.conf.json` / `Cargo.*` 增量 | Tauri 托盘、依赖 | **多数不适用**（web 无 Tauri 托盘）；仅 `Cargo.toml` 新依赖按需取 | — 跳过 Tauri runtime 专属 |

## 3. 提交依赖与顺序

骨架链（必须先行，互相依赖）：
`8b3ad9ca`(3P 网关骨架+claude_desktop_config) → `953b7cdc`(去 displayName) → `60a36283`(`[1M]`→`supports1m`) → `84bac6dc`(route id 锁角色) → `6a3c2fe0`(Copilot/Codex OAuth 供应商) → `4eb5543d`(20 provider proxy→direct) → `c460a404`(官方预设)

UX/修复链（依赖骨架，可后置）：
`5bbd83f7`(44 预设) · `ed41a7a7`/`417ad814`(app-switcher) · `2deee109`/`21b9eb04`/`309f7609`/`34698723`/`83f4e1d0`/`1fa01902`/`44d4ea81`/`270f49a4`/`c12364a9`(表单/导入流/修复)

> 注意：直接按提交时序 cherry-pick **不可行**（runtime 不同 + web proxy 已偏离）。下方按"功能切片"而非"提交"推进。

## 4. 分阶段方案

### Phase 0 — 脚手架与类型（低风险，~0.5–1 天）✅ 已完成 2026-05-17
- 扩 `AppId`（TS 联合，新增 `"claude-desktop"`）+ `AppType`（Rust 枚举 `ClaudeDesktop`，serde `rename="claude-desktop"` + alias）
- `appConfig.tsx` `APP_ICON_MAP` 增 `claude-desktop`（Claude 同款图标/chip）；**不进 `APP_IDS`/`MCP_SKILLS_APP_IDS`**，UI 不暴露；`visibleApps`/`ProxyTakeoverStatus` 默认 `false`
- 收口全部 `Record<AppId,…>`/exhaustive 站点（前端 ~15 处 + 测试夹具）；后端 ~30 处 `match AppType`（含 `#[cfg(test)]`）
  - 运行时路径：返回显式「claude-desktop 运行时尚未实现（C-Phase0 脚手架）」错误或 `unreachable!`
  - 结构/同族路径（prompt 文件 CLAUDE.md、proxy adapter、common-config、skills 目录等）：与 `AppType::Claude` 合并分支（Claude-family，Phase 0 下不可达）
  - MCP/Skills：按 OpenClaw 既有「不支持」先例处理（false/skip）
- 验证门槛全过：`tsc --noEmit` 0；vitest 184 passed/2 skipped；`cargo test --lib` 776 passed/0 failed；`cargo check` 干净
- 修复 1 处测试基线回归：`McpFormModal.test.tsx` apps 形状补 `"claude-desktop": false`
- **产出可独立合并**，后续阶段在其上叠加

### Phase 1 — 后端核心模块（中风险，~2–3 天）
- 移植 `claude_desktop_config.rs`（1561 行）到 `backend/src/`，适配 `AppError`/`Database`/路径函数
- DB：新增网关 token 表/迁移，对齐 web schema 版本线
- 单测优先移植（cc-switch 自带 snapshot/rollback/映射测试），先红后绿
- 验证：`cargo test` 该模块全绿，不碰 web 既有 775 测试

### Phase 2 — 网关路由与 proxy 三方合并（**最高风险**，~3–5 天）
- `web_server.rs` 注册 `/claude-desktop/v1/{models,messages}`，接入 web proxy forwarder
- 逐文件 3-way merge `proxy/{provider_router,model_mapper,handlers,forwarder}` 的 claude-desktop 增量到 web 已偏离版本
- OAuth 供应商校验放开（复用 web 已有 `codex_oauth_auth.rs`/`copilot_auth.rs`）
- 网关 token 每请求校验
- 验证：移植 cc-switch 的 OAuth proxy 回归测试 + 新增网关 e2e（token 校验、direct/proxy 模式、模型映射）

### Phase 3 — 后端命令与状态（中风险，~1–2 天）
- `commands/proxy.rs`/`codex_oauth.rs` 增量 → web 命令 + `/api/...` 路由
- `get_claude_desktop_status`（stale models / missing routes / proxy stopped / base url mismatch / missing token）
- 验证：HTTP 集成测试覆盖 status 漂移信号

### Phase 4 — 前端（中高风险，~3–4 天）
- `ClaudeDesktopProviderForm`：按 web `src/lib/api` hooks 重建（非 Tauri invoke），appId guard
- `AppSwitcher` 区分 Claude Code/Desktop；ProviderList 状态 banner（5s 轮询，用 react-query）
- 路由启停开关
- 验证：vitest 组件/集成测试，复用 web 测试夹具风格

### Phase 5 — 预设与 i18n（低风险，~1 天）
- `claudeDesktopProviderPresets.ts` + 44 预设（含 4eb5543d 的 20 个 proxy→direct、c460a404 官方预设、6a3c2fe0 OAuth 预设）
- zh/en/ja 文案
- 验证：tsc + 预设渲染快照

### Phase 6 — 收尾（~0.5 天）
- 全量 `tsc` / `cargo test --lib` / vitest / `vite build`
- 文档：用户指南（对应 cc-switch `4f0f103a`）
- CHANGELOG 与本计划归档

**粗估总量：~14–20 个工程日**，Phase 2 是关键路径与最大不确定性来源。

## 5. 主要风险

1. **Phase 2 proxy 三方合并**——web proxy 已独立演进，cc-switch 的 claude-desktop 改动可能与 web 的 proxy 改动冲突，需逐行判定语义而非文本合并。建议 Phase 2 先做一份 web↔cc-switch proxy 差异基线报告再动手。
2. **运行时绑定重写**——所有 Tauri `invoke` 调用点要换成 web HTTP API；前端表单数据层不可直接搬。
3. **schema/迁移**——网关 token 持久化要并入 web 的 DB 版本线，避免与 web 既有迁移冲突。
4. **AppId 扩展的连锁**——`Record<AppId,…>` 遍布前后端，Phase 0 必须靠 tsc/cargo 全量收口，否则后续阶段反复踩。
5. **测试基线保护**——web 现有 cargo 775 / vitest 184 必须始终不回归，每阶段设独立验证门槛、阶段产出可独立合并/回滚。

## 6. 建议

- 按 Phase 顺序推进，**每个 Phase 独立分支 + 独立验证门槛 + 可单独合并**。
- 正式动 Phase 2 前，先单独产出一份 `proxy` 子系统 web↔cc-switch 差异基线，作为合并依据。
- Phase 0 可立即低风险启动；Phase 1+ 需要专门排期。
