import { getSourceFormatProfiles } from "@cchistory/source-adapters";
import {
  getFlag,
  getFlagValues,
  parseNumberFlag,
  requireFlag,
  type ParsedArgs,
} from "../args.js";
import { listVisibleProjects } from "../renderers.js";
import {
  type CliIo,
  type CommandOutput,
  openReadStore,
} from "../main.js";
import { resolveSessionRef, resolveTurnRef } from "../resolvers.js";

export async function handleQueryAlias(parsed: ParsedArgs, io: CliIo): Promise<CommandOutput> {
  const [target] = parsed.positionals;
  const readStore = await openReadStore(parsed, io);
  try {
    const { storage } = readStore;
    switch (target) {
      case "turns": {
        const query = getFlag(parsed, "search");
        const projectId = getFlag(parsed, "project");
        const sourceIds = getFlagValues(parsed, "source");
        const limit = parseNumberFlag(parsed, "limit") ?? 20;
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
        const turnRef = requireFlag(parsed, "id");
        const turn = resolveTurnRef(storage, turnRef);
        const json = {
          turn,
          context: storage.getTurnContext(turn.id),
          lineage: storage.getTurnLineage(turn.id),
        };
        return { text: JSON.stringify(json, null, 2), json };
      }
      case "sessions": {
        const projectId = getFlag(parsed, "project");
        const sourceIds = getFlagValues(parsed, "source");
        const limit = parseNumberFlag(parsed, "limit") ?? 20;
        const json = storage
          .listResolvedSessions()
          .filter((session) => (projectId ? session.primary_project_id === projectId : true))
          .filter((session) => (sourceIds.length > 0 ? sourceIds.includes(session.source_id) : true))
          .slice(0, limit);
        return { text: JSON.stringify(json, null, 2), json };
      }
      case "session": {
        const sessionRef = requireFlag(parsed, "id");
        const session = resolveSessionRef(storage, sessionRef);
        const json = {
          session,
          related_work: storage.getSessionRelatedWork(session.id),
          turns: storage.listResolvedTurns().filter((turn) => turn.session_id === session.id),
        };
        return { text: JSON.stringify(json, null, 2), json };
      }
      case "projects": {
        const json = listVisibleProjects(storage, parsed);
        return { text: JSON.stringify(json, null, 2), json };
      }
      case "project": {
        const projectId = requireFlag(parsed, "id");
        const json = {
          project: storage.getProject(projectId),
          turns: storage.listProjectTurns(projectId, (getFlag(parsed, "link-state") as "all" | "committed" | "candidate" | "unlinked" | undefined) ?? "all"),
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

export async function handleTemplates(): Promise<CommandOutput> {
  const json = getSourceFormatProfiles();
  return {
    text: JSON.stringify(json, null, 2),
    json,
  };
}
