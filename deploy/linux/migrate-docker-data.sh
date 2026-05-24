#!/usr/bin/env bash
set -euo pipefail

VOLUME_NAME="cc-switch-web-data"
TARGET_DIR="/home/ubuntu/.cc-switch"
SERVICE_USER="ubuntu"
SERVICE_GROUP="ubuntu"
TMP_DIR="$(mktemp -d)"

cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "缺少命令：$1" >&2
    exit 1
  fi
}

ensure_not_root() {
  if [ "$(id -u)" -eq 0 ]; then
    echo "请使用 ${SERVICE_USER} 用户运行本脚本，不要直接 sudo 执行。脚本会在需要时调用 sudo。" >&2
    exit 1
  fi
}

docker_cmd() {
  if docker info >/dev/null 2>&1; then
    docker "$@"
  else
    sudo docker "$@"
  fi
}

resolve_volume_name() {
  if docker_cmd volume inspect "$VOLUME_NAME" >/dev/null 2>&1; then
    echo "$VOLUME_NAME"
    return
  fi

  local matched
  matched="$(docker_cmd volume ls --format '{{.Name}}' | grep -E "(^|_)${VOLUME_NAME}$" | head -n 1 || true)"
  if [ -n "$matched" ]; then
    echo "$matched"
    return
  fi

  return 1
}

ensure_not_root
require_command docker
require_command sudo

if [ -e "$TARGET_DIR" ]; then
  echo "目标目录已存在，未覆盖：$TARGET_DIR" >&2
  echo "如需重新迁移，请先手动备份并移走该目录。" >&2
  exit 1
fi

RESOLVED_VOLUME="$(resolve_volume_name)" || {
  echo "未找到 Docker volume：$VOLUME_NAME" >&2
  exit 1
}

docker_cmd run --rm \
  -v "${RESOLVED_VOLUME}:/data:ro" \
  -v "${TMP_DIR}:/backup" \
  alpine:3.20 \
  sh -c 'test -d /data/.cc-switch && cp -a /data/.cc-switch /backup/.cc-switch'

if [ ! -d "$TMP_DIR/.cc-switch" ]; then
  echo "Docker volume 中未找到 /data/.cc-switch。" >&2
  exit 1
fi

sudo install -d -o "$SERVICE_USER" -g "$SERVICE_GROUP" "$(dirname "$TARGET_DIR")"
sudo cp -a "$TMP_DIR/.cc-switch" "$TARGET_DIR"
sudo chown -R "${SERVICE_USER}:${SERVICE_GROUP}" "$TARGET_DIR"

echo "已迁移 Docker volume ${RESOLVED_VOLUME}:/data/.cc-switch 到 $TARGET_DIR"
