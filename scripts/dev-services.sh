#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "${ROOT_DIR}/scripts/dev-service-common.sh"

ACTION="${1:-status}"
TARGET="${2:-all}"

usage() {
  cat <<'EOF'
Usage:
  bash scripts/dev-services.sh <start|stop|restart|run|status> [web|api|all]

  run   - run a single service in the foreground (no daemon, no auto-restart)
EOF
}

service_targets() {
  local target="$1"
  case "${target}" in
    all)
      printf 'api\nweb\n'
      ;;
    web|api)
      printf '%s\n' "${target}"
      ;;
    *)
      usage >&2
      exit 1
      ;;
  esac
}

start_service() {
  local service="$1"
  local supervisor_pid_file supervisor_log_file supervisor_pid listener_pids

  require_service_name "${service}"
  supervisor_pid_file="$(service_supervisor_pid_file "${service}")"
  supervisor_log_file="$(service_supervisor_log_file "${service}")"
  cleanup_stale_pid_file "${supervisor_pid_file}"
  supervisor_pid="$(read_pid_file "${supervisor_pid_file}")"
  listener_pids="$(port_listener_pids "${service}" | tr '\n' ' ' | sed -E 's/[[:space:]]+/ /g; s/^ //; s/ $//')"

  if is_pid_alive "${supervisor_pid}"; then
    echo "${service}: already running (supervisor ${supervisor_pid})"
    return
  fi

  if [[ -n "${listener_pids}" ]]; then
    echo "${service}: already running (unmanaged listener ${listener_pids})"
    return
  fi

  mkdir -p "$(dirname "${supervisor_log_file}")"
  printf '\n[%s] starting %s supervisor\n' "$(date '+%Y-%m-%d %H:%M:%S')" "${service}" >> "${supervisor_log_file}"
  nohup bash "${ROOT_DIR}/scripts/dev-service-supervisor.sh" "${service}" >> "${supervisor_log_file}" 2>&1 < /dev/null &

  if wait_for_service_ready "${service}" 120; then
    supervisor_pid="$(read_pid_file "${supervisor_pid_file}")"
    echo "${service}: started supervisor ${supervisor_pid}"
    return
  fi

  supervisor_pid="$(read_pid_file "${supervisor_pid_file}")"
  if is_pid_alive "${supervisor_pid}"; then
    echo "${service}: supervisor started but service did not become ready in time" >&2
    return 1
  fi

  echo "${service}: failed to start supervisor" >&2
  return 1
}

stop_service() {
  local service="$1"
  require_service_name "${service}"
  stop_service_processes "${service}"
  echo "${service}: stopped"
}

restart_service() {
  local service="$1"
  stop_service "${service}"
  start_service "${service}"
}

run_service() {
  local service="$1"
  local command
  require_service_name "${service}"
  stop_service_processes "${service}"

  echo "[run] preparing ${service}..."
  if ! service_prepare "${service}"; then
    echo "[run] ${service}: prepare failed" >&2
    return 1
  fi

  command="$(service_launch_command "${service}")"
  echo "[run] ${service}: starting in foreground (no auto-restart)"
  echo "[run] command: ${command}"
  echo "---"
  bash -lc "${command}"
}

status_service() {
  local service="$1"
  local supervisor_pid_file child_pid_file supervisor_pid child_pid port log_file supervisor_log_file listener_pids state supervisor_holders
  require_service_name "${service}"

  supervisor_pid_file="$(service_supervisor_pid_file "${service}")"
  child_pid_file="$(service_child_pid_file "${service}")"
  cleanup_stale_pid_file "${supervisor_pid_file}"
  cleanup_stale_pid_file "${child_pid_file}"

  supervisor_pid="$(read_pid_file "${supervisor_pid_file}")"
  child_pid="$(read_pid_file "${child_pid_file}")"
  port="$(service_port "${service}")"
  log_file="$(service_child_log_file "${service}")"
  supervisor_log_file="$(service_supervisor_log_file "${service}")"
  listener_pids="$(port_listener_pids "${service}" | tr '\n' ' ' | sed -E 's/[[:space:]]+/ /g; s/^ //; s/ $//')"
  supervisor_holders="$(file_holder_pids "${supervisor_log_file}" | tr '\n' ' ' | sed -E 's/[[:space:]]+/ /g; s/^ //; s/ $//')"

  if is_pid_alive "${supervisor_pid}" || [[ -n "${supervisor_holders}" ]]; then
    state="running (managed)"
  elif is_pid_alive "${child_pid}" || [[ -n "${listener_pids}" ]]; then
    state="running (unmanaged)"
  else
    state="stopped"
  fi
  echo "${service}: ${state}"
  echo "  supervisor pid: ${supervisor_pid:-none}"
  echo "  supervisor log holder pid(s): ${supervisor_holders:-none}"
  echo "  child pid: ${child_pid:-none}"
  echo "  port listener pid(s): ${listener_pids:-none}"
  echo "  port: ${port}"
  echo "  app log: ${log_file}"
  echo "  supervisor log: ${supervisor_log_file}"

  if command -v lsof >/dev/null 2>&1; then
    lsof -iTCP:"${port}" -sTCP:LISTEN -n -P || true
  fi
}

case "${ACTION}" in
  start)
    while read -r service; do
      start_service "${service}"
    done < <(service_targets "${TARGET}")
    ;;
  stop)
    while read -r service; do
      stop_service "${service}"
    done < <(service_targets "${TARGET}")
    ;;
  restart)
    while read -r service; do
      restart_service "${service}"
    done < <(service_targets "${TARGET}")
    ;;
  run)
    run_service "${TARGET}"
    ;;
  status)
    while read -r service; do
      status_service "${service}"
    done < <(service_targets "${TARGET}")
    ;;
  *)
    usage >&2
    exit 1
    ;;
esac
