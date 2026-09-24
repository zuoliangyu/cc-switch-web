param(
  [string]$Choice = ''
)

# CC Switch Web 常用命令菜单（Windows PowerShell 5.1 / PowerShell 7）。
# 用法：.\menu.ps1          交互选择
#       .\menu.ps1 <编号>   直接执行对应项，例如 .\menu.ps1 8

$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot

$items = @(
  @{ Label = '本地开发（前端 Vite + Rust 后端）'; Command = 'pnpm'; Args = @('dev', '--', 'w') },
  @{ Label = 'Docker 前台开发'; Command = 'pnpm'; Args = @('dev', '--', 'd') },
  @{ Label = '静态检查（tsc + cargo check）'; Command = 'pnpm'; Args = @('check') },
  @{ Label = '前端测试（vitest）'; Command = 'pnpm'; Args = @('exec', 'vitest', 'run', '--exclude', '.claude/**') },
  @{ Label = 'Rust 测试（cargo test）'; Command = 'cargo'; Args = @('test', '--locked', '--manifest-path', 'backend/Cargo.toml') },
  @{ Label = '本地 release 构建（前端打包 + Rust 二进制）'; Command = 'pnpm'; Args = @('build', '--', 'w') },
  @{ Label = 'Docker 镜像构建'; Command = 'pnpm'; Args = @('build', '--', 'd') },
  @{ Label = 'Docker 全量验证（检查/测试 + Linux 打包 + 镜像冒烟）'; Command = 'pnpm'; Args = @('verify:docker', '--', 'all') },
  @{ Label = 'Docker 仅检查与测试'; Command = 'pnpm'; Args = @('verify:docker', '--', 'verify') },
  @{ Label = 'Docker 导出 Linux x64/arm64 发布包'; Command = 'pnpm'; Args = @('verify:docker', '--', 'package') },
  @{ Label = 'Docker 镜像冒烟检查'; Command = 'pnpm'; Args = @('verify:docker', '--', 'smoke') },
  @{ Label = '导出本地产物（Windows + Linux + Docker 镜像包）'; Command = 'powershell'; Args = @('-ExecutionPolicy', 'Bypass', '-File', 'scripts\package-artifacts.ps1') }
)

function Show-Menu {
  Write-Host '==== CC Switch Web ===='
  for ($i = 0; $i -lt $items.Count; $i++) {
    Write-Host ('{0,2}) {1}' -f ($i + 1), $items[$i].Label)
  }
  Write-Host ' 0) 退出'
}

function Invoke-MenuItem {
  param([string]$Value)

  if ($Value -eq '0') {
    return 0
  }
  $index = 0
  if (-not [int]::TryParse($Value, [ref]$index) -or $index -lt 1 -or $index -gt $items.Count) {
    Write-Host ('无效选项：{0}' -f $Value)
    return 1
  }
  $item = $items[$index - 1]
  Write-Host ('>> {0} {1}' -f $item.Command, ($item.Args -join ' '))
  $itemArgs = $item.Args
  & $item.Command @itemArgs
  return $LASTEXITCODE
}

if (-not $Choice) {
  Show-Menu
  $Choice = Read-Host '请选择'
}

exit (Invoke-MenuItem -Value $Choice)
