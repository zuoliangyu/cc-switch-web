# 预设分组选择器跟进计划（2026-11）

## 1. 背景与决定

上游在 `b999b07b`（2026-10-03，v7 视觉改版）把供应商预设选择器重写为分组式，`e9170adb` 又把同一家的区域 / 套餐合成一行。10 月那一轮（[2026-10 台账](web-parity-post-f8788719-2026-10.md)）迁 v7 / v8 时按当时的约束「供应商与预设列表一律按显示名称 A–Z、不按身份分组优先」保留了扁平 A–Z 预设布局，区域 / 套餐各占一行。

本轮基线后依赖分组选择器的改动（见第 3 节）只能部分迁移，台账里写成了「随 5a」，实际没有批次承接。

2026-11-05 用户决定：

- **预设选择器完全按上游分组**：登录 / 厂商 / 第三方 / 云 / 本地 / 插件分节，节内按显示名称 A–Z，同一家的区域 / 套餐合成一行并用下拉选版本。原「预设一律 A–Z、不按身份分组」约束对预设选择器放宽为此规则。
- **不变的约束**：不展示赞助 / 合作标签、徽章、星标、心形、特殊高亮，不因赞助 / 合作关系置顶；已保存的供应商列表仍按显示名称 A–Z；故障转移队列保持路由优先级。上游最终版选择器不按赞助身份排序，与此一致。
- **主题保留 Web 自己的 CSS 变量**，不引入上游 v7 / v8 设计令牌；迁入的上游类名继续映射到 Web 变量（如 `text-fg-2` → `text-muted-foreground`），并顺手修掉已有的映射遗漏。

## 2. 上游现状（upstream/main）

- `src/components/providers/forms/presetGroups.ts`（482 行）：`presetGroup` 分组、`groupPresetRows` / `presetVersions` / `presetVersionLayout` 合并行与版本布局、行名与版本标签、搜索匹配、`sectionPresetRows` 分节、`sortPresetRowsByName` 节内排序、`presetNeedsRouting`、`loginAccountKey`。
- `src/components/providers/forms/ProviderPresetSelector.tsx`（922 行）：分节列表、合并行的区域 / 套餐下拉、登录类预设的「用 xx 账号登录」副行、需要路由标记。
- 使用方：ProviderForm、ClaudeDesktopProviderForm、GrokBuildProviderForm、KimiProviderForm、McodeProviderForm、PiProviderForm。Web 前五个已用选择器，Pi / omp 用自己的预设下拉。
- Web 已有：预设数据上的 `regionKey` / `planKey` 与 `presetFamilies.ts`、`presetStep.tsx`、`presetSearchAliases.ts`、类别标签。

## 3. 回填的台账条目

| 提交 | 内容 | 现标记 | 跟进后 |
| --- | --- | --- | --- |
| `8686c165` | 「本地」分组 | 部分迁移 | 已迁移 |
| `1f21c289` | 「用 DeepSeek 账号登录」副行 | 部分迁移 | 已迁移 |
| `23dc945e` | SiliconFlow 两个区域合成一行的用例 | 已迁移（用例放弃） | 补回用例 |
| `3069b556` | presetRows 金样用例 | 已迁移（用例未迁） | 补回用例 |
| `c7dceb80` | Antigravity 对 `presetGroups.ts` 的改动 | 已迁移 | 核对补齐 |
| `7da25538` | Kimi 登录对 `presetGroups.ts` 的改动 | 已迁移 | 核对补齐 |

`src/config/kimiProviderPresets.test.ts` 里「presetGroups 随批次 5a」的注释一并改正。

## 4. 分批

排在 5a4b 之后、5b 之前，按顺序执行，每批单独提交。

1. **5c1 分组逻辑**：迁入上游最终版 `presetGroups.ts`（纯函数，不碰界面），补上游分组 / 合并行 / 版本布局用例，含 3069b556 的 presetRows 金样与 23dc945e 的 SiliconFlow 合并用例。核对 c7dceb80、7da25538 的分组改动。Web 现有选择器里的 A–Z 工具函数与其用例按新规则调整或移除。
2. **5c2 选择器界面**：按上游最终版重写 `ProviderPresetSelector`：分节、合并行与区域 / 套餐下拉、登录副行（1f21c289）、本地分组（8686c165）、需要路由标记、搜索（沿用 `presetSearchAliases`）。样式用 Web 主题变量。迁入上游 `ProviderPresetSelector.test.tsx` 最终版并按 Web 夹具改写；五个已有使用方保持可用，「先编号再过滤 hidden」的 id 稳定规则（3069b556）不得回退。
3. **5c3 Pi / omp 接入、文档与回填**：Pi / omp 表单改用共用选择器（上游做法）；回填第 3 节台账标记，改正 Kimi 用例注释；三语 README（第 9 行与升级注意）、CHANGELOG、`docs/claude-codex-routing-guide-zh.md`、`docs/pi-frontend-uiux-guidelines-zh.md`、`docs/web-global-resources-guide-zh.md` 中「预设按 A–Z」的表述改为新规则，赞助 / 合作约束保持不变。
