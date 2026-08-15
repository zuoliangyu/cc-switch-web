# scripts 目录说明

这个目录用于存放仓库的本地自动化脚本，不属于前端页面代码，也不属于后端业务代码。

它的主要作用是统一这些重复操作：

- 启动开发环境
- 构建发布产物
- 执行静态检查
- 导出本地打包产物
- 处理图标资源

## 文件类型说明

### `.mjs`

用于 Node.js 脚本。

在当前仓库里，这类文件主要负责：

- `dev`
- `build`
- `check`

也就是项目级命令入口。

### `.js`

也是 JavaScript 文件。

当前 `scripts/` 目录里的 `.js` 主要是资源处理脚本，不是日常启动/构建入口。

### `.ps1`

用于 Windows PowerShell。

这类脚本主要是为了方便在 Windows 上直接运行，对应封装仓库里的 `Node.js` 脚本或本地打包流程。

## 当前脚本用途

### 日常入口

- `dev.mjs`
  - 开发启动入口
  - 支持本地开发模式和 Docker 前台开发模式

- `build.mjs`
  - 构建入口
  - 支持本地 release 构建和 Docker 镜像构建

- `check.mjs`
  - 检查入口
  - 负责运行脚本语法检查、TypeScript 检查、Rust `cargo check`

### Windows 入口

- `dev.ps1`
  - Windows PowerShell 下的开发入口
  - 本质上调用 `dev.mjs`

- `build.ps1`
  - Windows PowerShell 下的构建入口
  - 本质上调用 `build.mjs`

- `check.ps1`
  - Windows PowerShell 下的检查入口
  - 本质上调用 `check.mjs`

- `package-artifacts.ps1`
  - Windows 本地产物导出脚本
  - 默认一次生成三类产物：
    - Windows 可执行文件
    - Linux 发布包
    - Docker 镜像包
  - 也支持单独模式：
    - `w`：仅 Windows
    - `l`：仅 Linux
    - `d`：仅 Docker

### 图标处理脚本

- `generate-icon-index.js`
  - 根据现有图标资源生成索引

## 常用命令对应关系

- `pnpm dev`
  - 对应 `scripts/dev.mjs`

- `pnpm build`
  - 对应 `scripts/build.mjs`

- `pnpm check`
  - 对应 `scripts/check.mjs`

- `.\scripts\dev.ps1 w`
  - Windows 下直接启动本地开发

- `.\scripts\build.ps1 w`
  - Windows 下直接执行本地构建

- `.\scripts\check.ps1`
  - Windows 下直接执行检查

- `.\scripts\package-artifacts.ps1`
  - Windows 下直接导出 Windows / Linux / Docker 三类产物

- `.\scripts\package-artifacts.ps1 w`
  - Windows 下仅导出 Windows 可执行文件

- `.\scripts\package-artifacts.ps1 l`
  - Windows 下仅导出 Linux 发布包

- `.\scripts\package-artifacts.ps1 d`
  - Windows 下仅导出 Docker 镜像包

## 建议理解方式

可以把这个目录理解为“仓库命令工具箱”：

- `mjs/js` 负责 Node.js 自动化逻辑
- `ps1` 负责 Windows 直接可执行入口

如果只是日常开发，通常只需要关注这些脚本：

- `dev.mjs`
- `build.mjs`
- `check.mjs`
- `dev.ps1`
- `build.ps1`
- `check.ps1`
- `package-artifacts.ps1`
