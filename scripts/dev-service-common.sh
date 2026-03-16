#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEV_SERVICE_DIR="${ROOT_DIR}/.dev-services"
PNPM_BIN="${PNPM_BIN:-$(command -v pnpm || true)}"
LAUNCHED_CHILD_PID=""
LAUNCHED_CHILD_WAIT_MODE="process"

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

service_wait_mode() {
  local service="$1"
  case "${service}" in
    web)
      echo "listener"
      ;;
    api)
      echo "process"
      ;;
  esac
}

service_child_pid_file() {
  local service="$1"
  echo "${DEV_SERVICE_DIR}/${service}.pid"
}

service_child_log_file() {
  local service="$1"
  echo "${DEV_SERVICE_DIR}/${service}.log"
}

service_temp_dir() {
  local service="$1"
  echo "${DEV_SERVICE_DIR}/tmp/${service}"
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
  local results=""
  port="$(service_port "${service}")"
  if command -v lsof >/dev/null 2>&1; then
    results="$(lsof -tiTCP:"${port}" -sTCP:LISTEN 2>/dev/null || true)"
  fi
  if [[ -z "${results}" ]] && command -v fuser >/dev/null 2>&1; then
    results="$(fuser "${port}/tcp" 2>/dev/null || true)"
  fi
  if [[ -n "${results}" ]]; then
    printf '%s\n' "${results}" | tr ' ' '\n' | sed '/^$/d'
  fi
}

file_holder_pids() {
  local target_file="$1"
  if [[ ! -f "${target_file}" ]]; then
    return
  fi
  if command -v lsof >/dev/null 2>&1; then
    lsof -t "${target_file}" 2>/dev/null || true
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
  local child_pid_file child_pid port_pid runtime_log_file runtime_pid

  child_pid_file="$(service_child_pid_file "${service}")"
  cleanup_stale_pid_file "${child_pid_file}"
  child_pid="$(read_pid_file "${child_pid_file}")"
  runtime_log_file="$(service_child_log_file "${service}")"

  if [[ -n "${child_pid}" ]]; then
    stop_pid_tree "${child_pid}"
    rm -f "${child_pid_file}"
  fi

  while read -r port_pid; do
    [[ -n "${port_pid}" ]] || continue
    stop_pid_tree "${port_pid}"
  done < <(port_listener_pids "${service}")

  while read -r runtime_pid; do
    [[ -n "${runtime_pid}" ]] || continue
    stop_pid_tree "${runtime_pid}"
  done < <(file_holder_pids "${runtime_log_file}")
}

stop_service_processes() {
  local service="$1"
  local supervisor_pid_file supervisor_log_file supervisor_pid logged_pid

  supervisor_pid_file="$(service_supervisor_pid_file "${service}")"
  supervisor_log_file="$(service_supervisor_log_file "${service}")"
  cleanup_stale_pid_file "${supervisor_pid_file}"
  supervisor_pid="$(read_pid_file "${supervisor_pid_file}")"

  if [[ -n "${supervisor_pid}" ]]; then
    stop_pid_tree "${supervisor_pid}"
    rm -f "${supervisor_pid_file}"
  fi

  while read -r logged_pid; do
    [[ -n "${logged_pid}" ]] || continue
    stop_pid_tree "${logged_pid}"
  done < <(file_holder_pids "${supervisor_log_file}")

  stop_service_runtime "${service}"
}

service_prepare() {
  local service="$1"
  local tsc_bin
  mkdir -p "$(service_temp_dir "${service}")"
  case "${service}" in
    web)
      if [[ -z "${PNPM_BIN}" ]]; then
        echo "pnpm not found in PATH" >&2
        return 1
      fi
      run_with_prepare_node_options "${PNPM_BIN}" --filter @cchistory/api-client build
      ;;
    api)
      tsc_bin="${ROOT_DIR}/node_modules/.bin/tsc"
      run_with_prepare_node_options "${tsc_bin}" -p "${ROOT_DIR}/packages/domain/tsconfig.json"
      run_with_prepare_node_options "${tsc_bin}" -p "${ROOT_DIR}/packages/source-adapters/tsconfig.json"
      run_with_prepare_node_options "${tsc_bin}" -p "${ROOT_DIR}/packages/storage/tsconfig.json"
      ;;
  esac
}

run_with_prepare_node_options() {
  local node_options_value
  node_options_value="--max-old-space-size=${SERVICE_PREPARE_NODE_MEMORY_MB:-512}"
  if [[ -n "${NODE_OPTIONS:-}" ]]; then
    node_options_value="${NODE_OPTIONS} ${node_options_value}"
  fi
  env NODE_OPTIONS="${node_options_value}" "$@"
}

service_launch_command() {
  local service="$1"
  local web_dir api_dir next_bin tsx_bin node_options_value api_node_options_value service_tmp_dir
  service_tmp_dir="$(service_temp_dir "${service}")"
  case "${service}" in
    web)
      web_dir="${ROOT_DIR}/apps/web"
      next_bin="${web_dir}/node_modules/.bin/next"
      node_options_value="--max-old-space-size=${NODE_MEMORY_MB:-640}"
      if [[ -n "${NODE_OPTIONS:-}" ]]; then
        node_options_value="${NODE_OPTIONS} ${node_options_value}"
      fi
      printf 'cd %q && exec env TMPDIR=%q TMP=%q TEMP=%q NODE_OPTIONS=%q %q dev --webpack --hostname 0.0.0.0 --port 8085' \
        "${web_dir}" "${service_tmp_dir}" "${service_tmp_dir}" "${service_tmp_dir}" "${node_options_value}" "${next_bin}"
      ;;
    api)
      api_dir="${ROOT_DIR}/apps/api"
      tsx_bin="${api_dir}/node_modules/.bin/tsx"
      api_node_options_value="--max-old-space-size=${API_NODE_MEMORY_MB:-256}"
      if [[ -n "${NODE_OPTIONS:-}" ]]; then
        api_node_options_value="${NODE_OPTIONS} ${api_node_options_value}"
      fi
      printf 'cd %q && exec env TMPDIR=%q TMP=%q TEMP=%q PORT=%q NODE_OPTIONS=%q %q watch src/index.ts' \
        "${api_dir}" "${service_tmp_dir}" "${service_tmp_dir}" "${service_tmp_dir}" "${PORT:-8040}" "${api_node_options_value}" "${tsx_bin}"
      ;;
  esac
}

wait_for_service_ready() {
  local service="$1"
  local max_attempts="${2:-120}"
  local supervisor_pid_file child_pid_file supervisor_pid listener_pid attempt
  supervisor_pid_file="$(service_supervisor_pid_file "${service}")"
  child_pid_file="$(service_child_pid_file "${service}")"

  for attempt in $(seq 1 "${max_attempts}"); do
    cleanup_stale_pid_file "${supervisor_pid_file}"
    cleanup_stale_pid_file "${child_pid_file}"

    supervisor_pid="$(read_pid_file "${supervisor_pid_file}")"
    if [[ -z "${supervisor_pid}" ]]; then
      sleep 0.5
      continue
    fi
    if ! is_pid_alive "${supervisor_pid}"; then
      return 1
    fi

    # Start-all must wait for the actual bound listener, not just the watch parent process.
    listener_pid="$(port_listener_pids "${service}" | head -n 1)"
    if [[ -n "${listener_pid}" ]]; then
      return 0
    fi

    sleep 0.5
  done

  return 1
}

wait_for_service_listener() {
  local service="$1"
  local launcher_pid="$2"
  local listener_pid=""
  local attempt

  for attempt in $(seq 1 40); do
    listener_pid="$(port_listener_pids "${service}" | head -n 1)"
    if [[ -n "${listener_pid}" ]]; then
      printf '%s\n' "${listener_pid}"
      return 0
    fi
    if ! is_pid_alive "${launcher_pid}"; then
      break
    fi
    sleep 0.5
  done

  return 1
}

launch_service_child() {
  local service="$1"
  local child_pid_file child_log_file command launcher_pid listener_pid wait_mode

  child_pid_file="$(service_child_pid_file "${service}")"
  child_log_file="$(service_child_log_file "${service}")"
  command="$(service_launch_command "${service}")"
  wait_mode="$(service_wait_mode "${service}")"

  mkdir -p "$(dirname "${child_log_file}")"
  printf '\n[%s] launching %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "${service}" >> "${child_log_file}"

  nohup bash -lc "${command}" >> "${child_log_file}" 2>&1 < /dev/null &
  launcher_pid="$!"
  listener_pid="$(wait_for_service_listener "${service}" "${launcher_pid}" || true)"

  if [[ "${wait_mode}" == "listener" && -n "${listener_pid}" ]]; then
    LAUNCHED_CHILD_PID="${listener_pid}"
    LAUNCHED_CHILD_WAIT_MODE="poll"
  else
    LAUNCHED_CHILD_PID="${launcher_pid}"
    LAUNCHED_CHILD_WAIT_MODE="process"
  fi

  echo "${LAUNCHED_CHILD_PID}" > "${child_pid_file}"
}

wait_for_managed_child() {
  local wait_mode="${1:-process}"
  local child_pid="${2:-}"

  if [[ -z "${child_pid}" ]]; then
    return 1
  fi

  if [[ "${wait_mode}" == "poll" ]]; then
    while is_pid_alive "${child_pid}"; do
      sleep 1
    done
    return 0
  fi

  wait "${child_pid}"
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
