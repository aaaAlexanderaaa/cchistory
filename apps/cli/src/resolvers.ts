import {
  getLocalPathBasename,
  normalizeLocalPathIdentity,
  type ProjectIdentity,
  type SessionProjection,
  type SourceStatus,
  type UserTurnProjection,
} from "@cchistory/domain";
import type { CCHistoryStorage } from "@cchistory/storage";
import { truncateText } from "./renderers.js";

export function resolveProjectRef(storage: CCHistoryStorage, ref: string): ProjectIdentity {
  const projects = storage.listProjects();
  const direct = projects.find((project) => project.project_id === ref);
  if (direct) {
    return direct;
  }
  const slugMatches = projects.filter((project) => project.slug === ref);
  if (slugMatches.length === 1) {
    return slugMatches[0]!;
  }
  throw new Error(`Unknown project reference: ${ref}`);
}

export function resolveSessionRef(storage: CCHistoryStorage, ref: string): SessionProjection {
  const direct = storage.getResolvedSession(ref) ?? storage.getSession(ref);
  if (direct) {
    return direct;
  }

  const sessions = storage.listResolvedSessions();
  const normalizedRef = normalizeSessionRefToken(ref);

  const prefixMatch = resolveUniqueSessionMatch(ref, sessions.filter((session) => session.id.startsWith(ref)), "ID prefix");
  if (prefixMatch) {
    return prefixMatch;
  }

  const titleMatch = resolveUniqueSessionMatch(
    ref,
    sessions.filter((session) => normalizeSessionRefToken(session.title) === normalizedRef),
    "title",
  );
  if (titleMatch) {
    return titleMatch;
  }

  const normalizedWorkspaceRef = normalizeSessionPathRefToken(ref);
  const workspaceMatch = resolveUniqueSessionMatch(
    ref,
    sessions.filter((session) => {
      if (!session.working_directory || !normalizedWorkspaceRef) {
        return false;
      }
      const normalizedWorkspace = normalizeSessionPathRefToken(session.working_directory);
      const normalizedBasename = normalizeSessionPathRefToken(getLocalPathBasename(session.working_directory));
      return normalizedWorkspace === normalizedWorkspaceRef || normalizedBasename === normalizedWorkspaceRef;
    }),
    "workspace",
  );
  if (workspaceMatch) {
    return workspaceMatch;
  }

  throw new Error(`Unknown session reference: ${ref}`);
}

export function resolveTurnRef(storage: CCHistoryStorage, ref: string): UserTurnProjection {
  const direct = storage.getResolvedTurn(ref) ?? storage.getTurn(ref);
  if (direct) {
    return direct;
  }

  const turns = storage.listResolvedTurns();

  const exactAliasMatch = resolveUniqueTurnMatch(
    ref,
    turns.filter(
      (turn) =>
        (turn.turn_id != null && turn.turn_id === ref) ||
        turn.revision_id === ref ||
        turn.turn_revision_id === ref,
    ),
    "ID",
  );
  if (exactAliasMatch) {
    return exactAliasMatch;
  }

  const prefixMatch = resolveUniqueTurnMatch(
    ref,
    turns.filter(
      (turn) =>
        turn.id.startsWith(ref) ||
        turn.turn_id?.startsWith(ref) ||
        turn.revision_id.startsWith(ref) ||
        turn.turn_revision_id?.startsWith(ref),
    ),
    "ID prefix",
  );
  if (prefixMatch) {
    return prefixMatch;
  }

  throw new Error(`Unknown turn reference: ${ref}`);
}

export function resolveSourceRef(storage: CCHistoryStorage, ref: string): SourceStatus {
  const sources = storage.listSources();
  const direct = sources.find((source) => source.id === ref);
  if (direct) {
    return direct;
  }
  const handleMatches = sources.filter((source) => formatSourceHandle(source) === ref);
  if (handleMatches.length === 1) {
    return handleMatches[0]!;
  }
  const slotMatches = sources.filter((source) => source.slot_id === ref);
  if (slotMatches.length === 1) {
    return slotMatches[0]!;
  }
  throw new Error(`Unknown source reference: ${ref}`);
}

function resolveUniqueSessionMatch(
  ref: string,
  matches: SessionProjection[],
  matchKind: string,
): SessionProjection | undefined {
  if (matches.length === 0) {
    return undefined;
  }
  if (matches.length === 1) {
    return matches[0]!;
  }
  const preview = matches.slice(0, 3).map(formatSessionRefPreview).join(", ");
  const remainder = matches.length > 3 ? ` (+${matches.length - 3} more)` : "";
  throw new Error(`Ambiguous session reference: ${ref}. Matched ${matchKind} ${preview}${remainder}`);
}

function resolveUniqueTurnMatch(
  ref: string,
  matches: UserTurnProjection[],
  matchKind: string,
): UserTurnProjection | undefined {
  if (matches.length === 0) {
    return undefined;
  }
  if (matches.length === 1) {
    return matches[0]!;
  }
  const preview = matches.slice(0, 3).map(formatTurnRefPreview).join(", ");
  const remainder = matches.length > 3 ? ` (+${matches.length - 3} more)` : "";
  throw new Error(`Ambiguous turn reference: ${ref}. Matched ${matchKind} ${preview}${remainder}`);
}

function formatSessionRefPreview(session: SessionProjection): string {
  const parts = [session.id];
  if (session.title) {
    parts.push(`title=${JSON.stringify(session.title)}`);
  }
  if (session.working_directory) {
    parts.push(`workspace=${JSON.stringify(session.working_directory)}`);
  }
  return parts.join(" ");
}

function formatTurnRefPreview(turn: UserTurnProjection): string {
  return `${turn.id} submitted=${turn.submission_started_at} prompt=${JSON.stringify(truncateText(turn.canonical_text, 48))}`;
}

function normalizeSessionRefToken(value: string | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

function normalizeSessionPathRefToken(value: string | undefined): string {
  const normalizedPath = normalizeLocalPathIdentity(value);
  return (normalizedPath ?? value)?.trim().toLowerCase() ?? "";
}

export function formatSourceHandle(source: SourceStatus): string {
  return `${source.slot_id}@${source.host_id}`;
}
