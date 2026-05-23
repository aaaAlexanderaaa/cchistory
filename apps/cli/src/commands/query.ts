import { getSourceFormatProfiles } from "@cchistory/source-adapters";
import type { CCHistoryStorage } from "@cchistory/storage";
import { listVisibleProjects } from "../renderers.js";
import {
  type CommandContext,
  type CommandOutput,
  openReadStore,
} from "../main.js";
import { resolveProjectRef, resolveSessionRef, resolveSourceRef, resolveTurnRef } from "../resolvers.js";

export async function handleQueryAlias(context: CommandContext): Promise<CommandOutput> {
  const target = context.commandPath[1] ?? context.positionals[0];
  validateQueryTarget(context, target);
  const readStore = await openReadStore(context);
  try {
    const { storage } = readStore;
    switch (target) {
      case "turns": {
        const query = context.options.search;
        const projectRef = context.options.project;
        const projectId = projectRef ? resolveProjectRef(storage, projectRef).project_id : undefined;
        const sourceIds = resolveSourceRefs(storage, context.options.source);
        const limit = context.options.limit ?? 20;
        const json = query
          ? storage.searchTurns({
              query,
              project_id: projectId,
              source_ids: sourceIds.length > 0 ? sourceIds : undefined,
              limit,
            })
          : storage
              .listResolvedTurns()
              .filter((turn) => (projectId ? turn.project_id === projectId : true))
              .filter((turn) => (sourceIds.length > 0 ? sourceIds.includes(turn.source_id) : true))
              .slice(0, limit);
        return {
          text: JSON.stringify(json, null, 2),
          json,
        };
      }
      case "turn": {
        const turnRef = requireOption(context.options.id, "id");
        const turn = resolveTurnRef(storage, turnRef);
        const json = {
          turn,
          context: storage.getTurnContext(turn.id),
          lineage: storage.getTurnLineage(turn.id),
        };
        return { text: JSON.stringify(json, null, 2), json };
      }
      case "sessions": {
        const projectRef = context.options.project;
        const projectId = projectRef ? resolveProjectRef(storage, projectRef).project_id : undefined;
        const sourceIds = resolveSourceRefs(storage, context.options.source);
        const limit = context.options.limit ?? 20;
        const json = storage
          .listResolvedSessions()
          .filter((session) => (projectId ? session.primary_project_id === projectId : true))
          .filter((session) => (sourceIds.length > 0 ? sourceIds.includes(session.source_id) : true))
          .slice(0, limit);
        return { text: JSON.stringify(json, null, 2), json };
      }
      case "session": {
        const sessionRef = requireOption(context.options.id, "id");
        const session = resolveSessionRef(storage, sessionRef);
        const json = {
          session,
          related_work: storage.getSessionRelatedWork(session.id),
          turns: storage.listResolvedTurns().filter((turn) => turn.session_id === session.id),
        };
        return { text: JSON.stringify(json, null, 2), json };
      }
      case "projects": {
        const sourceIds = resolveSourceRefs(storage, context.options.source);
        const projects = listVisibleProjects(storage, context);
        const json = sourceIds.length === 0
          ? projects
          : projects.filter((project) => projectHasSourceTurn(storage, project.project_id, sourceIds));
        return { text: JSON.stringify(json, null, 2), json };
      }
      case "project": {
        const project = resolveProjectRef(storage, requireOption(context.options.id, "id"));
        const sourceIds = resolveSourceRefs(storage, context.options.source);
        const json = {
          project,
          turns: storage
            .listProjectTurns(project.project_id, (context.options.linkState as "all" | "committed" | "candidate" | "unlinked" | undefined) ?? "all")
            .filter((turn) => (sourceIds.length > 0 ? sourceIds.includes(turn.source_id) : true)),
        };
        return { text: JSON.stringify(json, null, 2), json };
      }
      default:
        throw new Error("Unsupported query target.");
    }
  } finally {
    await readStore.close();
  }
}

function validateQueryTarget(context: CommandContext, target: string | undefined): void {
  const positionalLimit = context.commandPath[1] ? 0 : 1;
  if (context.positionals.length > positionalLimit) {
    throw new Error("Use `query turns|turn|sessions|session|projects|project ...`.");
  }
  switch (target) {
    case "turns":
    case "sessions":
    case "projects":
      return;
    case "turn":
    case "session":
    case "project":
      requireOption(context.options.id, "id");
      return;
    default:
      throw new Error("Use `query turns|turn|sessions|session|projects|project ...`.");
  }
}

function resolveSourceRefs(storage: CCHistoryStorage, refs: string[]): string[] {
  return refs.map((ref) => resolveSourceRef(storage, ref).id);
}

function projectHasSourceTurn(storage: CCHistoryStorage, projectId: string, sourceIds: string[]): boolean {
  return storage
    .listProjectTurns(projectId, "all")
    .some((turn) => sourceIds.includes(turn.source_id));
}

function requireOption(value: string | undefined, key: string): string {
  if (!value) {
    throw new Error(`Missing required --${key} flag.`);
  }
  return value;
}

export async function handleTemplates(): Promise<CommandOutput> {
  const json = getSourceFormatProfiles();
  return {
    text: JSON.stringify(json, null, 2),
    json,
  };
}
