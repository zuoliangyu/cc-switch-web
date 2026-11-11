# Web 跟进 cc-switch v4.0.29 及其后差异清单

> 状态：进行中（2026-11-11 建立）。
> 上游：`upstream` = `git@github.com:farion1231/cc-switch.git`，只读（push URL 为 `DISABLED_READ_ONLY`）。`remote.upstream.tagOpt = --no-tags`：取上游永远不带 tag；2026-11-11 已删掉本地 80 个上游 tag（名单在当时的临时目录），本地只留 Web 自己的 tag。
> 起点：`5e9812e0`（上一轮冻结目标）；目标：`upstream/main` = `abf50589`（v4.0.29 之后，2026-11-11）。
> 范围：29 个提交（无合并提交），113 个文件变化（+14535/−1463）。Web 起点为 `a26a99b8`（3.2.0 之后）。
> 前一轮：[v4.0.26–v4.0.28 迁移台账](web-parity-post-a3eafa40-2026-11.md)。验证命令与流程沿用前一轮；发版前另跑 `pnpm verify:docker -- verify`（CI 与发布镜像用 Rust 1.88，警告即错误）。

说明：Web 仓库与上游无共同 Git 历史，上游 `src-tauri/src/` 对应 Web `backend/src/`；上游补丁多数无法直接应用，按行为手工迁移。

## 1. 版本分布

| 版本 | 提交数 |
| --- | --- |
| v4.0.29 | 20 |
| 未发布 | 9 |

## 2. 主要内容

| 领域 | 上游变化 | Web 处理 |
| --- | --- | --- |
| Copilot CLI | 自带模型（BYOK）卡改为写进 Copilot 原生 `providers.json`（加 / 删、读失败保留、写前校验）、深链导入新形状与 `bearerToken`、会话用量归到所选卡、空模型列表说明 | 批次 B |
| 隐私过滤 | 路由 / 聚合模式下把请求里的个人信息与密钥换成占位符再转发（正则 + gitleaks 规则），默认关，工具结果另有子开关 | 批次 C |
| 代理 / Codex | Codex→Anthropic 默认 `max_tokens` 32000、第三方上游去掉 Codex 私有 include 标记、官方卡经路由透传官方模型列表、WSL 跑 Codex 时目录指针写文件名 | 批次 A |
| 杂项 | 只能走路由的卡禁用「打开终端」、Claude 账号额度先核对默认凭据归属、agy 额度带 cloudaicompanionProject 并提示地区不可用、omo-slim 无限重渲染、更新说明弹窗在 macOS / Linux 塌陷、VS Code copilot-shim、CCSub 推广字段 | 批次 A |
| i18n / 文档 / 发版 | 七种语言一起维护、ko/tr/ru 文案、上游 README 与发行说明 | 不适用（只保留 zh/en/ja） |

## 3. 批次与处置统计

| 批次 | 范围 | 提交数 | 状态 |
| --- | --- | --- | --- |
| A | 代理 / Codex / 杂项 | 13 | 待迁移 |
| B | Copilot 自带模型卡 | 9 | 待迁移 |
| C | 隐私过滤 | 1 | 已完成（1 已迁移） |
| — | 不适用 | 6 | — |

执行顺序：A → B → C，逐批提交。本机内存紧张（2026-11-11 曾因内存不足终止 Docker 验证），各批编译不并行。

## 4. 决策记录

- 沿用前几轮：不新增语言（只 zh/en/ja）；“打开目录”类功能改为显示 / 复制路径；预设按上游分组、组内 A–Z，不展示赞助 / 合作标识与置顶；主题保留 Web 的 CSS 变量；故障转移队列与卡片不做拖动排名。
- 2026-11-11：用户要求不再拉上游 tag（避免推送时带上），已设 `remote.upstream.tagOpt --no-tags` 并删除本地上游 tag。
- 发现的旧缺口（不属本轮）：上游 2026-07 起 Codex 表单有「最大输出 Token」项（`meta.maxOutputTokens`），Web 后端有该字段但表单没有输入项。

## 5. 提交矩阵

| 提交 | 版本 | 标题 | 批次 | 说明 | 处置 |
| --- | --- | --- | --- | --- | --- |
| `3bde8262` | v4.0.29 | fix(proxy): raise the Codex to Anthropic default max_tokens to 32000 | A | | 待迁移 |
| `aab0ea57` | v4.0.29 | fix(copilot): explain empty model lists and log both model counts | B | | 待迁移 |
| `17e20a59` | v4.0.29 | fix(copilot): only suggest gpt-4.1/gpt-4o as a fallback on Claude forms | B | | 待迁移 |
| `3561af53` | v4.0.29 | feat(i18n): maintain all seven UI languages together | — | 托盘、ru/tr/zh-TW 文案与七语言一致性测试；Web 只保留 zh/en/ja、无托盘 | 不适用 |
| `3dfc92c6` | v4.0.29 | fix(i18n): add ko, tr and ru strings for recent Copilot and max_tokens changes | — | 只改 ko/tr/ru | 不适用 |
| `9c0ab57f` | v4.0.29 | test(grok): expect the 32000 default in the max output tokens hint | A | | 待迁移 |
| `5d961a3a` | v4.0.29 | fix(terminal): disable the provider terminal for route-only cards | A | | 待迁移 |
| `7b657e02` | v4.0.29 | feat(copilot): keep BYOK cards in Copilot's native providers.json | B | | 待迁移 |
| `9bd9c516` | v4.0.29 | feat(copilot): attribute session usage to the selected BYOK card | B | | 待迁移 |
| `65720291` | v4.0.29 | feat(copilot): import deep links as providers.json cards | B | | 待迁移 |
| `8d866cef` | v4.0.29 | feat(copilot): manage BYOK cards with add/remove in the provider list | B | | 待迁移 |
| `83d744b9` | v4.0.29 | fix(claude-account): verify the default credential owner before reading quota | A | | 待迁移 |
| `81fd9c25` | v4.0.29 | test(claude-account): cover which slot the quota is read from | A | | 待迁移 |
| `0d69dd06` | v4.0.29 | feat(copilot): accept bearerToken and keep every model ID in deep links | B | | 待迁移 |
| `4d68975b` | v4.0.29 | fix(copilot): keep saved cards when providers.json cannot be read | B | | 待迁移 |
| `cf12f010` | v4.0.29 | fix(copilot): validate output limits and systemMessage before writing a card | B | | 待迁移 |
| `5c462269` | v4.0.29 | fix(codex): keep a bare model_catalog_json pointer when the desktop app runs Codex in WSL | A | | 待迁移 |
| `e38a4fd1` | v4.0.29 | fix(codex): pass the official model list through the route for official cards | A | | 待迁移 |
| `cb187a11` | v4.0.29 | chore(release): v4.0.29 | — | 上游版本号与 whats-new | 不适用 |
| `efbec38f` | v4.0.29 | docs(release): add v4.0.29 release notes | — | 上游发行说明 | 不适用 |
| `af791fd0` | 未发布 | fix(omo-slim): prevent infinite re-render when categories prop is undefined (#3905) | A | | 待迁移 |
| `3f15f878` | 未发布 | docs(readme): move RunAPI below SubRouter and remove CCSub from sponsors | — | 上游 README 赞助位 | 不适用 |
| `242abf78` | 未发布 | chore(presets): remove the CCSub promotion copy | A | | 待迁移 |
| `f57e24ce` | 未发布 | docs(readme): add Trendshift daily/weekly/monthly Rust badges | — | 上游 README 徽章 | 不适用 |
| `f38a612c` | 未发布 | fix(tools): skip VS Code copilot-shim when detecting Copilot CLI on Windows | A | | 待迁移 |
| `32365a54` | 未发布 | feat: add privacy filter for PII and secrets detection (#8951) | C | C：`proxy/privacy_filter`（PII 正则、gitleaks 规则集 + 上下文口令 + 熵兜底、四种请求格式的文本改写）与上游用例原样迁入；配置存 settings 表 `privacy_filter_config`（默认关，工具结果子开关默认关），新增 `GET/PUT /api/settings/privacy-filter`，打开时后台预热规则；Claude / Claude Desktop、Codex Chat / Responses / compact / 图片与独立透传、Gemini 六个入口在建好请求上下文后过滤（Session ID 与模型名仍按原始请求体提取），只在路由与聚合模式经过代理时生效；设置 › 数据里云同步之后加「隐私过滤器」（三语）。与上游不同：占位符语言取设置里的界面语言，没保存过时按服务进程的 `LC_ALL` / `LC_MESSAGES` / `LANG`，再没有用英文（上游按托盘语言 / 系统区域；Web 没有托盘，浏览器语言服务端拿不到）；补面板用例与区域名映射用例 | 已迁移 |
| `f16a9d74` | 未发布 | fix(ui): stop the what's-new dialog from collapsing on macOS and Linux (#9401) | A | | 待迁移 |
| `a6200c1e` | 未发布 | fix(proxy): drop Codex-private include markers for third-party upstreams (#9077) | A | | 待迁移 |
| `abf50589` | 未发布 | fix(agy): pass cloudaicompanionProject in quota lookup and surface region ineligibility (#9414) | A | | 待迁移 |

## 6. 执行记录

- 2026-11-11：建立台账。
- 2026-11-11 批次 C（隐私过滤）：见第 5 节 `32365a54`。验证：Rust 3901 项通过、10 项忽略（新增 30 项隐私过滤用例），`cargo check --bin cc-switch-web` 零警告；前端 270 个文件 2835 项通过，tsc 通过。上游对请求体大小没有单独上限（靠关键词预筛与线性正则，在请求任务里同步执行），Web 照搬。
