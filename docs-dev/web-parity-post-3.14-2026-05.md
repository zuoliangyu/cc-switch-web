# Web 端跟进上游补丁计划（0.3.0 之后）

## 背景

- 调查时间：2026-05-07
- 上游基线：`E:\zuolan_lib\cc-switch`，已 merge `upstream/main` 到 `9f2c2568`（2026-05-07）
- Web 基线：`E:\zuolan_lib\cc-switch-web`，版本 `0.3.0`（fc8a915，2026-04-24）
- 上一轮对齐计划：`docs-dev/web-parity-v3.14.0-plan-2026-04.md`（v3.14.0 三阶段已全部落地）
- 上一轮落地记录：`docs-dev/web-parity-2026-04.md`

`v3.14.0` 主线对齐已收尾，上游在那之后到现在（约两周）累计了 50+ 提交。剔除 Tauri runtime / CI / README / dependabot 类不适用项后，剩余 **~25 条**对 Web 后端有直接价值，按性质分两批落地：

- `0.3.1`：纯 bug 修复补丁（proxy / usage / config / 会话健壮性 / Windows 适配）
- `0.4.0`：新预设与 UI 增强

## 路径映射

上游 `src-tauri/src/...` → Web `backend/src/...`，前端 `src/...` 一致。Web 后端已有的目录结构与上游基本对齐，cherry-pick 时路径直接替换前缀即可。

## 0.3.1 — bug 修复补丁

### A. Proxy 修复（6 项）

| 上游 commit | 标题 | 影响文件 |
|------------|------|---------|
| `72ab8a5c` | fix(proxy): include zero usage in final message delta (#2485) | `backend/src/proxy/providers/streaming.rs` |
| `bdc4c1e8` | fix(proxy): derive Claude auth strategy from ANTHROPIC env var name | `backend/src/proxy/providers/claude.rs`、`backend/src/services/stream_check.rs` |
| `35bce246` | fix(proxy): strip leading billing header from system content (#2350) | `backend/src/proxy/providers/transform.rs`、`transform_responses.rs` |
| `295dd9a9` | fix(proxy): preserve Vertex AI full URLs (#2415) | `backend/src/proxy/gemini_url.rs`、`backend/src/services/stream_check.rs` |
| `21e2d68d` | fix(proxy): preserve scoped reasoning_content for tool calls (#2367) | `backend/src/proxy/providers/claude.rs`、`transform.rs` |
| `6441bc5c` | fix(proxy): dedupe streaming message_delta (#2366) | `backend/src/proxy/providers/streaming.rs` |

### B. Usage / Balance 修复（3 项）

| 上游 commit | 标题 | 影响文件 |
|------------|------|---------|
| `2ee7cb41` | fix(usage): prevent double-counting between proxy and session-log sources | `backend/src/database/dao/usage_rollup.rs`、`schema.rs`、`services/session_usage*.rs`、`usage_stats.rs` |
| `693c36a1` | fix(dashscope): enhance usage parsing robustness to prevent VSCode crash (#2425) | `backend/src/proxy/providers/streaming_responses.rs`、`transform_responses.rs` |
| `d2556be5` | fix(balance): show USD on SiliconFlow international site (was CNY) | `backend/src/services/balance.rs` |

### C. Model fetch / Coding plan / Codex 修复（5 项）

| 上游 commit | 标题 | 影响文件 |
|------------|------|---------|
| `67dbfc0a` | fix(model-fetch): support /models for Anthropic-compat subpath providers | `backend/src/services/model_fetch.rs`、`backend/src/commands/model_fetch.rs`、`src/components/providers/forms/ClaudeFormFields.tsx`、`src/lib/api/model-fetch.ts`、Claude 预设、三语 |
| `fcd83ee3` | fix(copilot): resolve Claude model IDs against live /models list | `backend/src/proxy/forwarder.rs`、新增 `backend/src/proxy/providers/copilot_model_map.rs`、`providers/mod.rs`、Claude 预设 |
| `fafc122d` | fix(coding-plan): correct zhipu weekly tier name by reset time (#2420) | `backend/src/services/coding_plan.rs` |
| `064b339b` | fix(claude): persist max effort via env (#2493) | Claude provider 链路（待精确定位） |
| `1c692694` | fix(codex): skip environment_context injection when extracting session title (#2439) | `backend/src/session_manager/providers/codex.rs` |
| `15497b0e` | fix(session): hide Codex subagent sessions (#2445) | `backend/src/session_manager/providers/codex.rs` |
| `a1e6c3b6` | 修复 Codex 切换供应商后历史记录变化 (#2349) | `backend/src/codex_config.rs`（如 Web 已存在）、`services/provider/live.rs`、`services/proxy.rs` |

### D. 配置 / 导入幂等（2 项）

| 上游 commit | 标题 | 影响文件 |
|------------|------|---------|
| `8084bfaf` | fix(config): sort JSON keys alphabetically for deterministic output (#2469) | `backend/src/config.rs` |
| `7965862e` | Make import existing side-effect free (#2429) | `backend/src/services/mcp.rs`、`services/skill.rs` |

### E. Windows / shell 适配（2 项）

| 上游 commit | 标题 | 影响文件 |
|------------|------|---------|
| `68f1f8d3` | feat(config): expand Windows env var placeholders in config JSON | `backend/src/commands/misc.rs`、`backend/src/lib.rs`、`src/components/providers/forms/CommonConfigEditor.tsx`、新增 `src/lib/windowsEnvPaths.ts`、三语 |
| `4536b95a` | refactor: prefer default shell in commands::try_get_version (#2286) | `backend/src/commands/misc.rs` |

### F. 提取自 reverted 提交的有效部分（1 项）

`f061b777 feat(usage): add Hermes Agent tracking + fix zero-cost bug + perf` 整体功能被 `518d945e` 撤销，但 commit message 提到 **zero-cost 修复 + perf 优化**。需要 diff 一下 `f061b777..518d945e` 中 `usage_stats.rs`、`session_usage_codex.rs`、`session_usage_gemini.rs`、`session_usage.rs`、`database/schema.rs` 的非 Hermes 部分（`session_usage_hermes.rs` 整体丢弃），单独提一笔补丁。

## 0.4.0 — 预设与 UI 增强

### G. 新预设（3 项）

| 上游 commit | 标题 | 影响文件 |
|------------|------|---------|
| `db66348f` | feat(providers): add Baidu Qianfan Coding Plan for Claude Code (#2322) | `backend/src/services/stream_check.rs`、Claude 预设、`src/hooks/useStreamCheck.ts`、三语 |
| `08e2b29b` | feat(compshare): add Coding Plan preset across claude/codex/hermes/openclaw | Claude/Codex/Hermes/OpenClaw 预设、三语 |
| `b1f9ce46` | feat(deepseek): switch presets to V4 (flash/pro) and add pricing | `backend/src/database/schema.rs`（pricing seed）、Claude/Hermes/OpenClaw/OpenCode 预设 |

### H. UI 增强（4 项）

| 上游 commit | 标题 | 影响文件 |
|------------|------|---------|
| `1d44b1ba` | feat(universal-provider): add duplicate action for universal providers (#2416) | `src/components/universal/UniversalProviderCard.tsx`、`UniversalProviderPanel.tsx`、三语 |
| `85f0be9e` | feat(provider-form): soften validation with "save anyway" prompt (#2307) | `src/components/providers/forms/ProviderForm.tsx`、`backend/src/services/model_fetch.rs`、三语 |
| `5b6339d7` | chore(codex): hide 1M context window toggle in provider edit form | `src/components/providers/forms/CodexConfigSections.tsx` |
| `bc1f9341` + `8e59a634` | refactor(theme): remove circular reveal animation | `src/components/theme-provider.tsx`、`src/index.css`、`src/components/mode-toggle.tsx`、`ThemeSettings.tsx` |

## 风险与注意事项

- **Codex / Claude 链路改动叠加**：A、C 两组都触碰 `proxy/providers/claude.rs` 和 `services/session_usage_*.rs`，cherry-pick 顺序按上游时间序，逐条解冲突
- **DAO / schema 改动**：B 组 `2ee7cb41` 改了 `usage_rollup.rs` 和 `database/schema.rs`，需要确认 Web 当前 schema 状态（已是 v10），如果只是字段或索引，不需要新建迁移；如果引入新列，要补一笔 v10→v11
- **`a1e6c3b6` 历史记录修复**：依赖 `codex_config.rs`，需先核对 Web 后端是否已有该模块及实现差异
- **`f061b777` 部分提取**：必须严格剔除 `session_usage_hermes.rs` 与所有 Hermes Agent tracking 集成代码，只保留 zero-cost / perf 修复
- **0.4.0 的 H 组（主题动画移除）**：上游同时移除了 `circular reveal` 的 CSS。Web 端 `src/index.css` 中是否带有该 keyframes 需先 grep 确认
- **国际化文件冲突**：`zh.json` / `en.json` / `ja.json` 几乎每条都改，按 commit 顺序合并最稳

## 验收标准

### 0.3.1

- 所有 A-F 组改动落地，本地 `cargo check` / `pnpm tsc --noEmit` 通过
- 现有 vitest / cargo test 全绿（重点关注 `usage_*` / `proxy/*` 测试）
- 至少一次手工链路验证：
  - 启用 dashscope 供应商发出请求，确认不再因 usage 解析触发 panic
  - SiliconFlow 国际站余额展示币种为 USD
  - Windows 下在 CommonConfigEditor 中输入 `%USERPROFILE%\.config` 能展开
- CHANGELOG.md 增补 `0.3.1` 段，README 三语同步版本号

### 0.4.0

- G 组三个预设可在前端选择、保存、流式 check 通过
- universal-provider 复制按钮可用，复制出新条目并保留独立配置
- provider-form 失败校验时弹出"仍要保存"，用户接受后能保存
- 主题切换无圆形扩散动画，深浅色切换平滑无卡顿
- CHANGELOG.md 增补 `0.4.0` 段，README 三语同步版本号

## 落地建议顺序

1. **第一步（0.3.1 准备）**：先打开本计划，按 A→B→C→D→E 组顺序 cherry-pick，每组一笔 commit，跑 lint + 测试
2. **第二步（F 组人工拆分）**：单独 diff `f061b777`，剔除 Hermes 部分，作为独立 commit "提取上游 usage zero-cost 修复"
3. **第三步**：发 0.3.1，更新 CHANGELOG / README 三语 / 版本号 / 迁移测试
4. **第四步（0.4.0）**：按 G→H 组继续，主题动画那笔放最后避免影响视觉验收
5. **第五步**：发 0.4.0

## 暂不纳入本轮

- `7b667f7a` Tauri window state — 只有桌面壳才有意义
- `7f0c7b11` 系统托盘 tooltip — 同上
- `7c8720bd` iTerm fallback / `608ee35e` Warp 启动 — 外部终端进程拉起，Web 后端已用 `preferred_terminal` 抽象
- `b61dad4b` Linux 主题段错误 — Tauri 前端在 GTK 下的崩溃
- 全部 CI / dependabot / README sponsor / docs(release-notes) 变更

## 备注

- 本文件是计划，不代表已落地；每完成一笔需在本文件追加日期 + 完成内容
- 每次发版前必须三语 README 同步检查
- 与上游同步 merge 的工作（如下次 0.5.x 再次拉上游）不在本计划范围内
