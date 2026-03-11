#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WEB_DIR="${ROOT_DIR}/apps/web"
PID_FILE="${WEB_DIR}/.next/preview-server.pid"
LOG_FILE="${WEB_DIR}/.next/preview-server.log"
NODE_MEMORY_MB="${NODE_MEMORY_MB:-1536}"

mkdir -p "${WEB_DIR}/.next"

EXISTING_PIDS=""
if command -v lsof >/dev/null 2>&1; then
  EXISTING_PIDS="$(lsof -tiTCP:8085 -sTCP:LISTEN || true)"
fi
if [[ -z "${EXISTING_PIDS}" ]] && command -v fuser >/dev/null 2>&1; then
  EXISTING_PIDS="$(fuser 8085/tcp 2>/dev/null || true)"
fi

if [[ -n "${EXISTING_PIDS}" ]]; then
  kill ${EXISTING_PIDS} || true
  sleep 1
fi

if [[ -f "${PID_FILE}" ]] && kill -0 "$(cat "${PID_FILE}")" 2>/dev/null; then
  kill "$(cat "${PID_FILE}")" || true
  sleep 1
fi

cd "${WEB_DIR}"
NODE_OPTIONS_VALUE="${NODE_OPTIONS:+${NODE_OPTIONS} }--max-old-space-size=${NODE_MEMORY_MB}"
NODE_OPTIONS="${NODE_OPTIONS_VALUE}" pnpm build >"${LOG_FILE}" 2>&1
setsid env NODE_OPTIONS="${NODE_OPTIONS_VALUE}" pnpm start >>"${LOG_FILE}" 2>&1 < /dev/null &
echo $! > "${PID_FILE}"

sleep 3

echo "PID $(cat "${PID_FILE}")"
echo "LOG ${LOG_FILE}"
if command -v lsof >/dev/null 2>&1; then
  lsof -iTCP:8085 -sTCP:LISTEN -n -P || true
fi
