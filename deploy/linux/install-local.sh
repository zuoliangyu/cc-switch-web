#!/usr/bin/env bash
set -euo pipefail

SERVICE_NAME="cc-switch-web"
SERVICE_USER="ubuntu"
SERVICE_GROUP="ubuntu"
SERVICE_PORT="5030"
INSTALL_DIR="/home/ubuntu/app/cc-switch-web"
DATA_DIR="/home/ubuntu/.cc-switch"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
SERVICE_TEMPLATE="$REPO_ROOT/deploy/systemd/cc-switch-web.local.service"
SERVICE_DEST="/etc/systemd/system/${SERVICE_NAME}.service"
BINARY_SOURCE="$REPO_ROOT/backend/target/release/cc-switch-web"
BINARY_DEST="$INSTALL_DIR/cc-switch-web"

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

check_port_available() {
  if command -v ss >/dev/null 2>&1; then
    if ss -H -ltn "sport = :${SERVICE_PORT}" | grep -q .; then
      echo "端口 ${SERVICE_PORT} 已被占用：" >&2
      ss -ltnp "sport = :${SERVICE_PORT}" >&2 || true
      exit 1
    fi
  elif command -v lsof >/dev/null 2>&1; then
    if lsof -iTCP:"${SERVICE_PORT}" -sTCP:LISTEN >/dev/null 2>&1; then
      echo "端口 ${SERVICE_PORT} 已被占用：" >&2
      lsof -iTCP:"${SERVICE_PORT}" -sTCP:LISTEN >&2 || true
      exit 1
    fi
  else
    echo "未找到 ss 或 lsof，无法检查端口 ${SERVICE_PORT} 是否可用。" >&2
    exit 1
  fi
}

stop_existing_systemd_service() {
  if systemctl list-unit-files "${SERVICE_NAME}.service" >/dev/null 2>&1; then
    sudo systemctl stop "${SERVICE_NAME}.service" || true
  fi
}

docker_cmd() {
  if docker info >/dev/null 2>&1; then
    docker "$@"
  else
    sudo docker "$@"
  fi
}

stop_old_docker_service() {
  if ! command -v docker >/dev/null 2>&1; then
    return
  fi

  if [ -f "$REPO_ROOT/docker-compose.yml" ]; then
    docker_cmd compose -f "$REPO_ROOT/docker-compose.yml" down || true
  fi

  if docker_cmd ps --format '{{.Names}}' | grep -Fxq "$SERVICE_NAME"; then
    docker_cmd stop "$SERVICE_NAME" >/dev/null || true
  fi
}

ensure_not_root
require_command pnpm
require_command sudo
require_command systemctl
require_command curl

export PATH="$HOME/.cargo/bin:$PATH"
require_command cargo

cd "$REPO_ROOT"

pnpm install --frozen-lockfile
pnpm check
pnpm build w

test -x "$BINARY_SOURCE"
test -f "$SERVICE_TEMPLATE"

sudo install -d -o "$SERVICE_USER" -g "$SERVICE_GROUP" "$INSTALL_DIR"
sudo install -d -o "$SERVICE_USER" -g "$SERVICE_GROUP" "$DATA_DIR"
sudo install -m 0755 "$BINARY_SOURCE" "$BINARY_DEST"
sudo install -m 0644 "$SERVICE_TEMPLATE" "$SERVICE_DEST"

stop_old_docker_service
stop_existing_systemd_service
check_port_available

sudo systemctl daemon-reload
sudo systemctl enable --now "${SERVICE_NAME}.service"

curl -fsS "http://127.0.0.1:${SERVICE_PORT}/api/health" >/dev/null

echo "CC Switch Web 已部署并运行：http://127.0.0.1:${SERVICE_PORT}"
