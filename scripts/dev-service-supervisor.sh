#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "${ROOT_DIR}/scripts/dev-service-common.sh"

SERVICE="${1:-}"
require_service_name "${SERVICE}"

SUPERVISOR_PID_FILE="$(service_supervisor_pid_file "${SERVICE}")"
CHILD_PID_FILE="$(service_child_pid_file "${SERVICE}")"
STOP_REQUESTED=0
CHILD_PID=""

log_line() {
  printf '[%s] [%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "${SERVICE}" "$*"
}

handle_stop_signal() {
  STOP_REQUESTED=1
  if [[ -n "${CHILD_PID}" ]]; then
    stop_pid_tree "${CHILD_PID}"
  fi
}

cleanup() {
  rm -f "${SUPERVISOR_PID_FILE}"
  cleanup_stale_pid_file "${CHILD_PID_FILE}"
}

trap handle_stop_signal INT TERM
trap cleanup EXIT

echo $$ > "${SUPERVISOR_PID_FILE}"
cleanup_stale_pid_file "${CHILD_PID_FILE}"

RESTART_ATTEMPT=0
while true; do
  if [[ "${STOP_REQUESTED}" -eq 1 ]]; then
    break
  fi

  if ! service_prepare "${SERVICE}"; then
    DELAY_SECONDS="$(restart_delay_seconds "${RESTART_ATTEMPT}")"
    log_line "preflight failed, retrying in ${DELAY_SECONDS}s"
    sleep "${DELAY_SECONDS}"
    RESTART_ATTEMPT=$((RESTART_ATTEMPT + 1))
    continue
  fi

  stop_service_runtime "${SERVICE}"
  echo $$ > "${SUPERVISOR_PID_FILE}"

  launch_service_child "${SERVICE}"
  CHILD_PID="${LAUNCHED_CHILD_PID}"
  STARTED_AT="$(date +%s)"
  log_line "started child pid ${CHILD_PID}"

  if wait "${CHILD_PID}"; then
    EXIT_CODE=0
  else
    EXIT_CODE=$?
  fi

  rm -f "${CHILD_PID_FILE}"

  if [[ "${STOP_REQUESTED}" -eq 1 ]]; then
    log_line "stopped"
    break
  fi

  RUNTIME_SECONDS=$(( $(date +%s) - STARTED_AT ))
  if [[ "${RUNTIME_SECONDS}" -ge 60 ]]; then
    RESTART_ATTEMPT=0
  else
    RESTART_ATTEMPT=$((RESTART_ATTEMPT + 1))
  fi

  DELAY_SECONDS="$(restart_delay_seconds "${RESTART_ATTEMPT}")"
  log_line "child exited with code ${EXIT_CODE} after ${RUNTIME_SECONDS}s, restarting in ${DELAY_SECONDS}s"
  sleep "${DELAY_SECONDS}"
done
