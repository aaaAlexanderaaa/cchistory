// This file is a compatibility barrel re-export.
// Implementation has been split into apps/api/src/remote-agent/ submodules.
export type { PersistedRemoteAgentState } from "./remote-agent/types.js";
export { EMPTY_REMOTE_AGENT_STATE } from "./remote-agent/types.js";
export { readRemoteAgentState, writeRemoteAgentState } from "./remote-agent/state-io.js";
export {
  authenticateRemoteAgent,
  pairRemoteAgent,
  buildPersistedSourceState,
  toSourceManifestEntry,
  agentMatchesSelector,
  applyRemoteAgentHeartbeat,
  listRemoteAgents,
  updateRemoteAgentLabels,
} from "./remote-agent/agent-ops.js";
export {
  createRemoteAgentJob,
  listRemoteAgentJobs,
  leaseRemoteAgentJob,
  completeRemoteAgentJob,
  requireLeasedJobAssignment,
} from "./remote-agent/job-ops.js";
export { applyRemoteAgentUpload } from "./remote-agent/upload-ops.js";
