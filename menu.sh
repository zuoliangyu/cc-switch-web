#!/usr/bin/env bash
# CC Switch Web 常用命令菜单（macOS / Linux / Git Bash）。
# 用法：./menu.sh          交互选择
#       ./menu.sh <编号>   直接执行对应项，例如 ./menu.sh 8
set -euo pipefail

cd "$(dirname "$0")"

items=(
  "本地开发（前端 Vite + Rust 后端）|pnpm dev -- w"
  "Docker 前台开发|pnpm dev -- d"
  "静态检查（tsc + cargo check）|pnpm check"
  "前端测试（vitest）|pnpm exec vitest run --exclude .claude/**"
  "Rust 测试（cargo test）|cargo test --locked --manifest-path backend/Cargo.toml"
  "本地 release 构建（前端打包 + Rust 二进制）|pnpm build -- w"
  "Docker 镜像构建|pnpm build -- d"
  "Docker 全量验证（检查/测试 + Linux 打包 + 镜像冒烟）|pnpm verify:docker -- all"
  "Docker 仅检查与测试|pnpm verify:docker -- verify"
  "Docker 导出 Linux x64/arm64 发布包|pnpm verify:docker -- package"
  "Docker 镜像冒烟检查|pnpm verify:docker -- smoke"
)

print_menu() {
  echo "==== CC Switch Web ===="
  local i=1
  for item in "${items[@]}"; do
    printf "%2d) %s\n" "$i" "${item%%|*}"
    i=$((i + 1))
  done
  echo " 0) 退出"
}

run_item() {
  local choice="$1"
  if [[ "$choice" == "0" ]]; then
    exit 0
  fi
  if ! [[ "$choice" =~ ^[0-9]+$ ]] || ((choice < 1 || choice > ${#items[@]})); then
    echo "无效选项：$choice" >&2
    return 1
  fi
  local item="${items[$((choice - 1))]}"
  local cmd="${item#*|}"
  echo ">> $cmd"
  # shellcheck disable=SC2086
  eval "$cmd"
}

if [[ $# -gt 0 ]]; then
  run_item "$1"
  exit $?
fi

print_menu
read -r -p "请选择: " choice
run_item "$choice"
