import type { FastifyInstance } from "fastify";
import type {
  RemoteAgentAdminSummary,
  RemoteAgentCollectionJobSummary,
  RemoteAgentCompleteJobRequest,
  RemoteAgentCreateJobRequest,
  RemoteAgentHeartbeatRequest,
  RemoteAgentLeaseJobRequest,
  RemoteAgentPairRequest,
  RemoteAgentUploadRequest,
} from "@cchistory/domain";
import type { CCHistoryStorage } from "@cchistory/storage";
import {
  applyRemoteAgentHeartbeat,
  applyRemoteAgentUpload,
  completeRemoteAgentJob,
  createRemoteAgentJob,
  leaseRemoteAgentJob,
  listRemoteAgentJobs,
  listRemoteAgents,
  pairRemoteAgent,
  updateRemoteAgentLabels,
  writeRemoteAgentState,
  type PersistedRemoteAgentState,
} from "../remote-agent.js";

export interface AgentRoutesContext {
  storage: CCHistoryStorage;
  getRemoteAgentState: () => PersistedRemoteAgentState;
  setRemoteAgentState: (state: PersistedRemoteAgentState) => void;
  remoteAgentStatePath: string;
  agentPairingToken?: string;
  rawStoreDir: string;
}

export function registerAgentRoutes(app: FastifyInstance, context: AgentRoutesContext) {
  app.post("/api/agent/pair", {
    schema: {
      body: {
        type: "object",
        required: ["pairing_token"],
        properties: {
          pairing_token: { type: "string" },
          display_name: { type: "string" },
          reported_hostname: { type: "string" },
        },
      },
    },
  }, async (request, reply) => {
    if (!context.agentPairingToken) {
      reply.code(503);
      return { error: "Remote agent pairing is not configured on this host." };
    }

    const body = (request.body ?? {}) as RemoteAgentPairRequest;
    if (body.pairing_token !== context.agentPairingToken) {
      reply.code(401);
      return { error: "Invalid pairing token." };
    }

    const paired = pairRemoteAgent({
      state: context.getRemoteAgentState(),
      displayName: body.display_name,
      reportedHostname: body.reported_hostname,
    });
    context.setRemoteAgentState(paired.state);
    await writeRemoteAgentState(context.remoteAgentStatePath, paired.state);
    return paired.response;
  });

  app.post("/api/agent/heartbeat", {
    schema: {
      body: {
        type: "object",
        required: ["agent_id", "agent_token"],
        properties: {
          agent_id: { type: "string" },
          agent_token: { type: "string" },
          display_name: { type: "string" },
          reported_hostname: { type: "string" },
          labels: { type: "array", items: { type: "string" } },
          source_manifest: { type: "array" },
        },
      },
    },
  }, async (request, reply) => {
    try {
      const applied = applyRemoteAgentHeartbeat({
        state: context.getRemoteAgentState(),
        request: (request.body ?? {}) as RemoteAgentHeartbeatRequest,
      });
      context.setRemoteAgentState(applied.state);
      await writeRemoteAgentState(context.remoteAgentStatePath, applied.state);
      return applied.response;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      reply.code(message.startsWith("Unauthorized") ? 401 : 400);
      return { error: message };
    }
  });

  app.post("/api/agent/jobs/lease", {
    schema: {
      body: {
        type: "object",
        required: ["agent_id", "agent_token"],
        properties: {
          agent_id: { type: "string" },
          agent_token: { type: "string" },
        },
      },
    },
  }, async (request, reply) => {
    try {
      const leased = leaseRemoteAgentJob({
        state: context.getRemoteAgentState(),
        request: (request.body ?? {}) as RemoteAgentLeaseJobRequest,
      });
      context.setRemoteAgentState(leased.state);
      await writeRemoteAgentState(context.remoteAgentStatePath, leased.state);
      return leased.response;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      reply.code(message.startsWith("Unauthorized") ? 401 : 400);
      return { error: message };
    }
  });

  app.post("/api/agent/uploads", {
    schema: {
      body: {
        type: "object",
        required: ["agent_id", "agent_token", "collected_at", "bundle", "source_manifest"],
        properties: {
          agent_id: { type: "string" },
          agent_token: { type: "string" },
          job_id: { type: "string" },
          collected_at: { type: "string" },
          bundle: { type: "object" },
          source_manifest: { type: "array" },
        },
      },
    },
  }, async (request, reply) => {
    try {
      const applied = await applyRemoteAgentUpload({
        state: context.getRemoteAgentState(),
        request: (request.body ?? {}) as RemoteAgentUploadRequest,
        rawStoreDir: context.rawStoreDir,
        storage: context.storage,
      });
      context.setRemoteAgentState(applied.state);
      await writeRemoteAgentState(context.remoteAgentStatePath, applied.state);
      return applied.response;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      reply.code(
        message.startsWith("Unauthorized")
          ? 401
          : message.startsWith("Stale remote upload rejected") || message.startsWith("Remote agent job lease expired")
            ? 409
            : 400,
      );
      return { error: message };
    }
  });

  app.post("/api/agent/jobs/:jobId/complete", {
    schema: {
      body: {
        type: "object",
        required: ["agent_id", "agent_token", "status"],
        properties: {
          agent_id: { type: "string" },
          agent_token: { type: "string" },
          status: { type: "string", enum: ["succeeded", "failed"] },
          error_message: { type: "string" },
          bundle_id: { type: "string" },
          imported_source_ids: { type: "array", items: { type: "string" } },
          replaced_source_ids: { type: "array", items: { type: "string" } },
          skipped_source_ids: { type: "array", items: { type: "string" } },
        },
      },
    },
  }, async (request, reply) => {
    const jobId = (request.params as { jobId: string }).jobId;
    try {
      const completed = completeRemoteAgentJob({
        state: context.getRemoteAgentState(),
        jobId,
        request: (request.body ?? {}) as RemoteAgentCompleteJobRequest,
      });
      context.setRemoteAgentState(completed.state);
      await writeRemoteAgentState(context.remoteAgentStatePath, completed.state);
      return completed.response;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      reply.code(message.startsWith("Unauthorized") ? 401 : message.startsWith("Remote agent job not found") ? 404 : 400);
      return { error: message };
    }
  });

  app.post("/api/admin/agent-jobs", {
    schema: {
      body: {
        type: "object",
        required: ["selector"],
        properties: {
          trigger_kind: { type: "string", enum: ["manual", "scheduled", "server_requested"] },
          selector: { type: "object" },
          source_slots: { anyOf: [{ type: "string", enum: ["all"] }, { type: "array", items: { type: "string" } }] },
          sync_mode: { type: "string", enum: ["dirty_snapshot", "force_snapshot"] },
          limit_files_per_source: { type: "number" },
          expected_generation: { type: "number" },
          lease_duration_seconds: { type: "number" },
        },
      },
    },
  }, async (request, reply) => {
    try {
      const created = createRemoteAgentJob({
        state: context.getRemoteAgentState(),
        request: (request.body ?? {}) as RemoteAgentCreateJobRequest,
      });
      context.setRemoteAgentState(created.state);
      await writeRemoteAgentState(context.remoteAgentStatePath, created.state);
      return { job: created.job };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      reply.code(message.startsWith("Remote agent not found") ? 404 : 400);
      return { error: message };
    }
  });

  app.get("/api/admin/agent-jobs", async () => ({
    jobs: listRemoteAgentJobs(context.getRemoteAgentState()) satisfies RemoteAgentCollectionJobSummary[],
  }));

  app.get("/api/admin/agents", async () => ({
    agents: listRemoteAgents(context.getRemoteAgentState()) satisfies RemoteAgentAdminSummary[],
  }));

  app.post("/api/admin/agents/:agentId/labels", {
    schema: {
      body: {
        type: "object",
        properties: {
          display_name: { type: "string" },
          labels: { type: "array", items: { type: "string" } },
        },
      },
    },
  }, async (request, reply) => {
    const agentId = (request.params as { agentId: string }).agentId;
    const body = (request.body ?? {}) as { display_name?: string; labels?: string[] };
    try {
      const updated = updateRemoteAgentLabels({
        state: context.getRemoteAgentState(),
        agentId,
        displayName: body.display_name,
        labels: body.labels,
      });
      context.setRemoteAgentState(updated.state);
      await writeRemoteAgentState(context.remoteAgentStatePath, updated.state);
      return { agent: updated.agent };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      reply.code(message.startsWith("Remote agent not found") ? 404 : 400);
      return { error: message };
    }
  });
}
