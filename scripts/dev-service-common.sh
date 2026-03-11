#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEV_SERVICE_DIR="${ROOT_DIR}/.dev-services"
PNPM_BIN="${PNPM_BIN:-$(command -v pnpm || true)}"
LAUNCHED_CHILD_PID=""

mkdir -p "${DEV_SERVICE_DIR}"

require_service_name() {
  local service="${1:-}"
  case "${service}" in
    web|api)
      ;;
    *)
      echo "Unsupported service: ${service}" >&2
      exit 1
      ;;
  esac
}

service_port() {
  local service="$1"
  case "${service}" in
    web)
      echo "8085"
      ;;
    api)
      echo "${PORT:-8040}"
      ;;
  esac
}

service_child_pid_file() {
  local service="$1"
  case "${service}" in
    web)
      echo "${ROOT_DIR}/apps/web/.next/dev-server.pid"
      ;;
    api)
      echo "${ROOT_DIR}/apps/api/.dev-server.pid"
      ;;
  esac
}

service_child_log_file() {
  local service="$1"
  case "${service}" in
    web)
      echo "${ROOT_DIR}/apps/web/.next/dev-server.log"
      ;;
    api)
      echo "${ROOT_DIR}/apps/api/.dev-server.log"
      ;;
  esac
}

service_supervisor_pid_file() {
  local service="$1"
  echo "${DEV_SERVICE_DIR}/${service}-supervisor.pid"
}

service_supervisor_log_file() {
  local service="$1"
  echo "${DEV_SERVICE_DIR}/${service}-supervisor.log"
}

read_pid_file() {
  local pid_file="$1"
  if [[ -f "${pid_file}" ]]; then
    tr -d '[:space:]' < "${pid_file}"
  fi
}

is_pid_alive() {
  local pid="${1:-}"
  [[ -n "${pid}" ]] && kill -0 "${pid}" 2>/dev/null
}

cleanup_stale_pid_file() {
  local pid_file="$1"
  local pid
  pid="$(read_pid_file "${pid_file}")"
  if [[ -n "${pid}" ]] && ! is_pid_alive "${pid}"; then
    rm -f "${pid_file}"
  fi
}

port_listener_pids() {
  local service="$1"
  local port
  port="$(service_port "${service}")"
  if command -v lsof >/dev/null 2>&1; then
    lsof -tiTCP:"${port}" -sTCP:LISTEN 2>/dev/null || true
    return
  fi
  if command -v fuser >/dev/null 2>&1; then
    fuser "${port}/tcp" 2>/dev/null || true
  fi
}

collect_process_tree() {
  local pid="${1:-}"
  if [[ -z "${pid}" ]] || ! [[ "${pid}" =~ ^[0-9]+$ ]]; then
    return
  fi
  if command -v pgrep >/dev/null 2>&1; then
    local child
    while read -r child; do
      [[ -n "${child}" ]] || continue
      collect_process_tree "${child}"
    done < <(pgrep -P "${pid}" 2>/dev/null || true)
  fi
  printf '%s\n' "${pid}"
}

stop_pid_tree() {
  local pid="${1:-}"
  local targets
  if ! is_pid_alive "${pid}"; then
    return
  fi

  targets="$(collect_process_tree "${pid}" | tr '\n' ' ')"
  if [[ -n "${targets}" ]]; then
    kill ${targets} 2>/dev/null || true
  else
    kill "${pid}" 2>/dev/null || true
  fi

  local attempt=0
  while is_pid_alive "${pid}" && [[ "${attempt}" -lt 20 ]]; do
    sleep 0.5
    attempt=$((attempt + 1))
  done

  if is_pid_alive "${pid}"; then
    if [[ -n "${targets}" ]]; then
      kill -9 ${targets} 2>/dev/null || true
    else
      kill -9 "${pid}" 2>/dev/null || true
    fi
  fi
}

stop_service_runtime() {
  local service="$1"
  local child_pid_file child_pid port_pid

  child_pid_file="$(service_child_pid_file "${service}")"
  cleanup_stale_pid_file "${child_pid_file}"
  child_pid="$(read_pid_file "${child_pid_file}")"

  if [[ -n "${child_pid}" ]]; then
    stop_pid_tree "${child_pid}"
    rm -f "${child_pid_file}"
  fi

  while read -r port_pid; do
    [[ -n "${port_pid}" ]] || continue
    stop_pid_tree "${port_pid}"
  done < <(port_listener_pids "${service}")
}

stop_service_processes() {
  local service="$1"
  local supervisor_pid_file supervisor_pid

  supervisor_pid_file="$(service_supervisor_pid_file "${service}")"
  cleanup_stale_pid_file "${supervisor_pid_file}"
  supervisor_pid="$(read_pid_file "${supervisor_pid_file}")"

  if [[ -n "${supervisor_pid}" ]]; then
    stop_pid_tree "${supervisor_pid}"
    rm -f "${supervisor_pid_file}"
  fi

  stop_service_runtime "${service}"
}

service_prepare() {
  local service="$1"
  local tsc_bin tsx_dir web_dir node_memory_mb
  case "${service}" in
    web)
      if [[ -z "${PNPM_BIN}" ]]; then
        echo "pnpm not found in PATH" >&2
        return 1
      fi
      "${PNPM_BIN}" --filter @cchistory/api-client build
      ;;
    api)
      tsc_bin="${ROOT_DIR}/node_modules/.bin/tsc"
      "${tsc_bin}" -p "${ROOT_DIR}/packages/domain/tsconfig.json"
      "${tsc_bin}" -p "${ROOT_DIR}/packages/source-adapters/tsconfig.json"
      "${tsc_bin}" -p "${ROOT_DIR}/packages/storage/tsconfig.json"
      ;;
  esac
}

service_launch_command() {
  local service="$1"
  local web_dir api_dir next_bin tsx_bin node_options_value
  case "${service}" in
    web)
      web_dir="${ROOT_DIR}/apps/web"
      next_bin="${web_dir}/node_modules/.bin/next"
      node_options_value="--max-old-space-size=${NODE_MEMORY_MB:-1536}"
      if [[ -n "${NODE_OPTIONS:-}" ]]; then
        node_options_value="${NODE_OPTIONS} ${node_options_value}"
      fi
      printf 'cd %q && exec env NODE_OPTIONS=%q %q dev --webpack --disable-source-maps --hostname 0.0.0.0 --port 8085' \
        "${web_dir}" "${node_options_value}" "${next_bin}"
      ;;
    api)
      api_dir="${ROOT_DIR}/apps/api"
      tsx_bin="${api_dir}/node_modules/.bin/tsx"
      printf 'cd %q && exec env PORT=%q %q watch src/index.ts' \
        "${api_dir}" "${PORT:-8040}" "${tsx_bin}"
      ;;
  esac
}

launch_service_child() {
  local service="$1"
  local child_pid_file child_log_file command

  child_pid_file="$(service_child_pid_file "${service}")"
  child_log_file="$(service_child_log_file "${service}")"
  command="$(service_launch_command "${service}")"

  mkdir -p "$(dirname "${child_log_file}")"
  printf '\n[%s] launching %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "${service}" >> "${child_log_file}"

  nohup bash -lc "${command}" >> "${child_log_file}" 2>&1 < /dev/null &
  LAUNCHED_CHILD_PID="$!"
  echo "${LAUNCHED_CHILD_PID}" > "${child_pid_file}"
}

restart_delay_seconds() {
  local attempt="${1:-0}"
  case "${attempt}" in
    0) echo "2" ;;
    1) echo "4" ;;
    2) echo "8" ;;
    3) echo "12" ;;
    *) echo "20" ;;
  esac
}
