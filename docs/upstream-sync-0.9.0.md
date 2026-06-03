# 上游同步计划 0.9.0（cc-switch 0.8.0 同步点之后）

同步点：上游 `09f67c1b`（2026-05-19，web 0.8.0 已搬到此）→ `upstream/main`（3.16.1）。
新增 114 个非 merge commit。本文档逐条跟踪移植状态。

映射约定：上游 `src-tauri/src/*` ↔ web `backend/src/*`；前端 `src/` 双方共享；
Tauri command（`src-tauri/src/lib.rs` invoke_handler）↔ web `commands` 模块 + HTTP 路由。

验证门槛（每阶段）：
- 前端 `pnpm exec tsc --noEmit` 0 错误 + `pnpm vitest run` 不回归
- 后端 `cargo check --locked --bin cc-switch-web` + `cargo test --lib` 全绿
- 收尾：`.\scripts\ci-check.ps1`（Docker CI 模拟）

---

## P0 · proxy/usage 核心 + Codex Chat 路由完善（强相关，必跟）

### Codex Chat 路由后续打磨
> 落地方式：3 个纯转换文件（transform_codex_chat / streaming_codex_chat / json_canonical）
> web 从未改过、与上游 baseline 0 分叉，直接整体换成上游最新版，一次性吸收大部分改进；
> 新增 codex_chat_common / codex_chat_history 模块 + provider::CodexChatReasoningConfig；
> ProxyState + RequestForwarder 线程化 codex_chat_history；handler 接 with_context/错误信封/
> SSE usage/历史 record+enrich。后端 862 tests 通过（含上游 bundled 测试）。
- [x] `74acf1e3` Add Codex Chat-to-Responses bridge（随文件替换）
- [x] `22fbe6f1` cache 稳定性：history store record+enrich + canonical JSON
- [x] `90b7f251` Restore Codex Chat reasoning fallback（随文件替换）
- [x] `9d357098` 折叠 mid-stream system 消息（随文件替换）
- [x] `b710c654` 回填占位 reasoning_content（随文件替换）
- [x] `5048ed63` stream_options.include_usage + SSE usage 收集（**已补 0.8.0 TODO**）
- [x] `f9db9913` 空 tool-call 参数强制 {}（随文件替换）
- [x] `ead9e22b` Chat 错误响应转 Responses 信封（handle_codex_chat_error_response）
- [x] `b4f262c7` 始终带 reasoning_tokens（随文件替换；见下方 proxy fix 区）
- [~] `2a4651a2` with_context 响应还原已接；**上游模型保留待 P1 catalog helpers**
- [ ] `44d9aabb` 自适应 reasoning 检测 —— 待 resolve/infer_codex_chat_reasoning_config（依赖 catalog helpers，随 P1 补）
- [ ] `72bc912e` Codex Chat provider 走 Stream Check（前端 + codex.rs）
- [ ] `184cbcdc` ClaudeAPI 重分类为 aggregator 恢复 model test
- [x] `279b9eab` 测试基线更新（直接采用上游 bundled 测试，N/A）

### proxy/usage 核心 fix
- [x] `9c2add9a` Claude 兼容模式流式空 tool_calls 致 block 状态重置（模式里过滤空数组，零重缩进）(#2915)
- [x] `554e3b48` DeepSeek Anthropic tool thinking 历史归一化 (#3203)
- [x] `e02a2763` thinking 归一化扩展 kimi/moonshot —— 取终态 REASONING_VENDOR_HINTS SSOT (#3377)
- [x] `707a5593` MiMo reasoning_content：claude.rs vendor 列表 + transform.rs redacted_thinking 占位（**claude_desktop_config.rs 的本地路由归一化部分延后 P1b**）(#2990)
- [x] `b4f262c7` 始终带 reasoning_tokens —— stage1 文件替换已覆盖 (#3514)
- [ ] `c12d20ef` proxy 安全模式替换 panic-prone unwrap/expect —— **延后 hygiene pass**（纯防御无行为变更，跨 6 个 web 分叉文件）
- [x] `f4e2c28a` 富化 Codex proxy 转发错误响应 + error_mapper 状态码对齐 IntoResponse（web 缺 StreamIdleTimeout/ProviderUnhealthy/InvalidRequest，已适配 catch-all）
- [ ] `bc1467db` 实时 stats 刷新 + 修非 ASCII 模型名 codex sync panic (#3027)
- [ ] `afa09e12` per-app 凭证解析（native 余额/coding-plan 查询）(#3355)

> 注：测试 `openclaw_config::default_model_noop_write_skips_backup` 在并行下偶发失败
> （共享 temp 目录竞态，与本次改动无关）；`--test-threads=1` 全绿 868 passed。

## P1 · Codex OAuth 接管 / model catalog / provider 行为
- [ ] `95f2dd41` 第三方切换时保留 OAuth 登录态
- [ ] `e25682d3` 托管账号 takeover model 字段取自目标 provider
- [ ] `60a9b330` 重构 Codex live-write 路由 + 覆盖默认 auth 覆写
- [ ] `c9cadd6e` 修 preserve 模式 takeover 清空 OAuth
- [ ] `ce993bae` 修 provider 误分类致 takeover 清空 OAuth
- [ ] `a04e72a2` 修编辑对话框遮蔽 live OAuth（前端）
- [ ] `2a131a55` 加固 takeover 所有权信号 + 串行化 switch/takeover
- [ ] `2683af57` + `3f59ab37` Codex auth preservation 设置（默认 opt-in 关）
- [ ] `41433cfa` provider 切换后 Codex 重启提示
- [ ] `59683363` Chat 第三方代理下保留 Codex 工具插件
- [ ] `d66030be` Codex 自定义工具 native input events 流式 ⚠️评估桌面特有
- [ ] `aeaa016c` / `b7499fc8` takeover 提示文案/label 刷新（前端）
- [ ] `8bf16602` provider 切换始终更新 model catalog JSON (#3360)
- [ ] `0fbba426` 修 live-config backfill 清空 catalog
- [ ] `d5328e52` 修 takeover-off 恢复丢失 catalog
- [ ] `ad8bdf16` live read active provider 时保留 catalog
- [ ] `791ced00` catalog WYSIWYG + 配置整合
- [ ] `9b957820` 修 catalog 无限渲染循环（前端）
- [ ] `7811383b` model_catalog_json 用相对文件名 (#3614)
- [ ] `b44f83f7` + `b15d9dfa` + `fc0433f2` 第三方统一进 "custom" history bucket / 路由键
- [ ] `a2ac21d0` 停止强改用户的 model_provider 字段
- [ ] `af60c7ed` 第三方 provider remote compaction 开关
- [ ] `3c3d4174` provider 模板启用 Codex goals (#3089)
- [ ] `5ef72a20` 多平台 CLI 发现 + gpt-5.5 模板兜底 (#3382) ⚠️CLI发现部分属Tauri

## P1b · Claude Desktop 子系统（web 0.7.0 已引入，相关）
- [ ] `0960fd71` Claude Desktop 官方供应商添加报错 (#3405)
- [ ] `05ba2801` proxy takeover 时同步 Claude Desktop profile (#3157)
- [ ] `864593bb` 修 Claude Desktop Cowork egress profile (#3172)
- [ ] `94cc3d10` Claude Desktop 模型映射对齐 Claude Code 三角色层级

## P2 · preset / 默认模型 / 供应商 / quota（前端共享，低风险）
- [ ] `c1dff066` ZenMux Token Plan 供应商 (#2709)
- [ ] `e71b9091` SudoCode preset
- [ ] `32b30e43` AtlasCloud preset
- [ ] `9ef14190` APINebula preset
- [ ] `8302f1e3` APIKEY.FUN preset
- [ ] `f2935a3d` 22 个第三方 Codex preset 接 Chat Completions 路由
- [ ] `0877b9e3` 默认 Claude Opus 升 4.8
- [ ] `3a154207` 全 preset 默认模型/定价更新 + `2b6ede14` 迁移测试期望
- [ ] `4bb4e994` + `3d6fb894` Shengsuanyun 前缀模型 ID + GPT 5.5
- [ ] `058c9fb8` OpenCode Go preset 去模型后缀
- [ ] `74104946` 移除 Codex 的 Kimi For Coding preset
- [ ] `6b0dd3c4` omo 推荐模型同步 + Fill Recommended 反馈
- [ ] `177eef66` ZhiPu quota 层级排序
- [ ] `43ae1e5f` MiniMax 余额新接口 + 默认定价 (#3518)
- [ ] `8e21b061` 修自定义 usage 脚本摘要 (#3129)
- [ ] `e9d84af5` session 含 Codex 归档会话 (#2861)
- [ ] `e605eba2` deeplink 导入 Claude provider 保留自定义 env (#2928)

## P2c · 工具管理子系统扩展（misc.rs + AboutSection，按序搬）
- [ ] `e3df8658` About 页扩成工具管理面板
- [ ] `820c4db1` CLI 版本探测扩到 PATH + Windows 包管理器 ✅Windows
- [ ] `768c5f9f` 忠实探测版本，不再掩盖"装了但跑不起来"
- [ ] `ea604a18` 工具卡片显示 installed but not runnable 态
- [ ] `ce232a14` 诊断冲突安装 + 卸载提示
- [ ] `ee2d634d` 托管 CLI 静默安装/更新生命周期（+ lib.rs 命令注册 + settings.ts）
- [ ] `f8b4d67b` 按工具逐个批量更新 + 操作期锁定
- [ ] `108dda17` 优先官方安装器，npm 兜底
- [ ] `014c82d2` 升级锚定到实际安装位置（新增 ToolInstallRow.tsx / ToolUpgradeConfirmDialog.tsx）
- [ ] `c6fd2415` 所有锚定升级分支强制绝对路径
- [ ] `67185974` 锚定升级扩到 Windows 原生路径 ✅Windows
- [ ] `3a77861d` 后端生成 source-aware 卸载命令提示
- [ ] `7cad61be` 去掉 CLI 卸载命令提示，保留冲突诊断
- [ ] `5de0a0dc` self-update 优先链 + hermes 改原生安装器
- [ ] `88ba908b` 统一 unix 安装器走 mktemp+bash + 修 WSL 缺原生安装器
- [ ] `d7a34f42` 版本检查处理 prerelease 工具
- [ ] `ee69c836` 修 Windows version probe 乱码 + 误报（改 Cargo.toml 加依赖）✅Windows
- [ ] `d7ede248` docs：工具管理 + Hermes 手册（可选）

## P3 · i18n / UI 杂项（可选，低优先）
- [ ] `5fd3ec0d` 繁体中文本地化 (#3093)
- [ ] `73073454` 中文 VS Code 措辞对齐 (#3228)
- [ ] `62928c62` AppSwitcher 文本去固定宽度防裁切 (#3161)
- [ ] `8cdaf90d` deepClone helper（取 deepClone，useTauriEvent 跳过）(#3140)
- [ ] `48473a5c` 德语 README / sponsor 类 `910ca3b4` `0e6f2b39` `85552cf4` `d905ed16`（按需）

## ⏭️ SKIP（纯 docs/release/CI + Tauri event）
`398f40da` `5315fa28` `04af87bc` `11edc96a` `8f83fa20` `fe3eb7e6` `47232cb0`
`256b0499` `c67494ba` `693c3872` `25951d81` `d8a42920` `00b6cc68`；
`8cdaf90d` 的 useTauriEvent hook 部分。
