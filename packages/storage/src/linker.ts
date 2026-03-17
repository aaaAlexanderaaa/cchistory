import { createHash } from "node:crypto";
import path from "node:path";
import type {
  DerivedCandidate,
  ProjectIdentity,
  ProjectLinkReason,
  ProjectLinkageState,
  ProjectManualOverride,
  ProjectObservation,
  SessionProjection,
  SourcePlatform,
  UserTurnProjection,
} from "@cchistory/domain";

export interface LinkedProjectObservation extends ProjectObservation {
  host_id: string;
  source_platform: SourcePlatform;
  workspace_subpath?: string;
  project_id?: string;
  linkage_state?: ProjectLinkageState;
  link_reason?: ProjectLinkReason;
}

export interface ProjectLinkSnapshot {
  projects: ProjectIdentity[];
  turns: UserTurnProjection[];
  sessions: SessionProjection[];
  observations: LinkedProjectObservation[];
}

export interface LinkingReview {
  committed_projects: ProjectIdentity[];
  candidate_projects: ProjectIdentity[];
  unlinked_turns: UserTurnProjection[];
  candidate_turns: UserTurnProjection[];
  project_observations: LinkedProjectObservation[];
}

interface ObservationLinkRule {
  linkage_state: ProjectLinkageState;
  reason: ProjectLinkReason;
  confidence: number;
  key: string;
}

interface ProjectGroup {
  project_id: string;
  project_revision_id: string;
  linkage_state: ProjectLinkageState;
  reason: ProjectLinkReason;
  confidence: number;
  observations: LinkedProjectObservation[];
}

interface DecoratedTurn extends UserTurnProjection {
  project_id?: string;
}

export function deriveProjectLinkSnapshot(input: {
  sessions: SessionProjection[];
  turns: UserTurnProjection[];
  candidates: DerivedCandidate[];
  overrides?: ProjectManualOverride[];
}): ProjectLinkSnapshot {
  const sessionsById = new Map(input.sessions.map((session) => [session.id, session]));
  const overrides = input.overrides ?? [];
  const overrideByTurnId = new Map(
    overrides.filter((override) => override.target_kind === "turn").map((override) => [override.target_ref, override]),
  );
  const overrideBySessionId = new Map(
    overrides.filter((override) => override.target_kind === "session").map((override) => [override.target_ref, override]),
  );
  const overrideByObservationId = new Map(
    overrides.filter((override) => override.target_kind === "observation").map((override) => [override.target_ref, override]),
  );
  const classifiedObservations: Array<{
    observation: LinkedProjectObservation;
    rule?: ObservationLinkRule;
  }> = input.candidates
    .filter((candidate) => candidate.candidate_kind === "project_observation")
    .map((candidate) => hydrateProjectObservation(candidate, sessionsById.get(candidate.session_ref)))
    .filter((observation): observation is LinkedProjectObservation => Boolean(observation))
    .map((observation) => ({
      observation,
      rule: classifyObservation(observation),
    }))
    .sort((left, right) => left.observation.observed_at.localeCompare(right.observation.observed_at));

  const groups = new Map<string, ProjectGroup>();
  for (const { observation, rule } of classifiedObservations) {
    if (!rule) {
      continue;
    }
    const existing = groups.get(rule.key);
    if (existing) {
      existing.observations.push(observation);
      continue;
    }
    const projectId = stableProjectId(rule.key);
    groups.set(rule.key, {
      project_id: projectId,
      project_revision_id: `${projectId}:r1`,
      linkage_state: rule.linkage_state,
      reason: rule.reason,
      confidence: rule.confidence,
      observations: [observation],
    });
  }

  for (const group of groups.values()) {
    group.confidence = deriveProjectGroupConfidence(group);
  }

  const linkedObservations = classifiedObservations.map(({ observation, rule }) => {
    if (!rule) {
      return observation;
    }
    const project = groups.get(rule.key);
    if (!project) {
      return observation;
    }
    return {
      ...observation,
      project_id: project.project_id,
      linkage_state: project.linkage_state,
      link_reason: project.reason,
    };
  });

  const projectById = new Map<string, ProjectIdentity>();
  for (const group of groups.values()) {
    const project = buildProjectIdentity(group);
    projectById.set(project.project_id, project);
  }

  for (const override of overrides) {
    if (!projectById.has(override.project_id)) {
      projectById.set(override.project_id, buildManualProjectIdentity(override));
    }
  }

  const observationsBySession = new Map<string, LinkedProjectObservation[]>();
  const overriddenObservations = linkedObservations.map((observation) => {
    const override = overrideByObservationId.get(observation.id) ?? overrideBySessionId.get(observation.session_ref);
    if (!override) {
      return observation;
    }
    return {
      ...observation,
      project_id: override.project_id,
      linkage_state: "committed" as const,
      link_reason: "manual_override" as const,
    };
  });
  for (const observation of overriddenObservations) {
    const existing = observationsBySession.get(observation.session_ref);
    if (existing) {
      existing.push(observation);
      continue;
    }
    observationsBySession.set(observation.session_ref, [observation]);
  }

  const turns = input.turns.map((turn) =>
    decorateTurn(
      turn,
      observationsBySession.get(turn.session_id) ?? [],
      projectById,
      overrideByTurnId.get(turn.id) ?? overrideBySessionId.get(turn.session_id),
    ),
  );
  const sessions = input.sessions.map((session) =>
    decorateSession(
      session,
      turns.filter((turn) => turn.session_id === session.id),
    ),
  );

  const projectTurnCounts = new Map<
    string,
    { committed_turn_count: number; candidate_turn_count: number; session_ids: Set<string>; last_activity_at?: string }
  >();
  for (const turn of turns) {
    if (!turn.project_id) {
      continue;
    }
    const counts = projectTurnCounts.get(turn.project_id) ?? {
      committed_turn_count: 0,
      candidate_turn_count: 0,
      session_ids: new Set<string>(),
    };
    if (turn.link_state === "committed") {
      counts.committed_turn_count += 1;
    } else if (turn.link_state === "candidate") {
      counts.candidate_turn_count += 1;
    }
    counts.session_ids.add(turn.session_id);
    counts.last_activity_at = maxIso(counts.last_activity_at, turn.last_context_activity_at);
    projectTurnCounts.set(turn.project_id, counts);
  }

  const projects = [...projectById.values()]
    .map((project) => {
      const counts = projectTurnCounts.get(project.project_id);
      const projectLastActivityAt = maxIso(project.project_last_activity_at, counts?.last_activity_at);
      const hasManualOverride = overrides.some((override) => override.project_id === project.project_id);
      return {
        ...project,
        linkage_state: hasManualOverride ? "committed" : project.linkage_state,
        link_reason: hasManualOverride ? "manual_override" : project.link_reason,
        manual_override_status: hasManualOverride ? "applied" : project.manual_override_status,
        committed_turn_count: counts?.committed_turn_count ?? 0,
        candidate_turn_count: counts?.candidate_turn_count ?? 0,
        session_count: counts?.session_ids.size ?? 0,
        project_last_activity_at: projectLastActivityAt,
        updated_at: maxIso(project.updated_at, projectLastActivityAt) ?? project.updated_at,
      };
    })
    .sort(compareProjectsByActivityDesc);

  return {
    projects,
    turns,
    sessions,
    observations: overriddenObservations.sort((left, right) => right.observed_at.localeCompare(left.observed_at)),
  };
}

export function buildLinkingReview(snapshot: ProjectLinkSnapshot): LinkingReview {
  return {
    committed_projects: snapshot.projects.filter((project) => project.linkage_state === "committed"),
    candidate_projects: snapshot.projects
      .filter((project) => project.linkage_state === "candidate")
      .sort((left, right) => compareConfidenceThenRecencyDesc(left.confidence, right.confidence, left.project_last_activity_at, right.project_last_activity_at)),
    unlinked_turns: snapshot.turns
      .filter((turn) => turn.link_state === "unlinked")
      .sort((left, right) => right.submission_started_at.localeCompare(left.submission_started_at)),
    candidate_turns: snapshot.turns
      .filter((turn) => turn.link_state === "candidate")
      .sort((left, right) =>
        compareConfidenceThenRecencyDesc(
          left.project_confidence ?? 0,
          right.project_confidence ?? 0,
          left.submission_started_at,
          right.submission_started_at,
        ),
      ),
    project_observations: snapshot.observations,
  };
}

function hydrateProjectObservation(
  candidate: DerivedCandidate,
  session: SessionProjection | undefined,
): LinkedProjectObservation | undefined {
  if (!session) {
    return undefined;
  }

  const evidence = candidate.evidence;
  const workspacePath = asOptionalString(evidence.workspace_path) ?? session.working_directory;
  const workspacePathNormalized =
    normalizePathKey(asOptionalString(evidence.workspace_path_normalized)) ?? normalizePathKey(workspacePath);
  const repoRoot = normalizePathKey(asOptionalString(evidence.repo_root));
  const repoRemote = asOptionalString(evidence.repo_remote);
  const repoFingerprint = asOptionalString(evidence.repo_fingerprint);

  return {
    id: candidate.id,
    source_id: candidate.source_id,
    session_ref: candidate.session_ref,
    observed_at: candidate.ended_at,
    confidence: asOptionalNumber(evidence.confidence) ?? 0.5,
    workspace_path: workspacePath,
    workspace_path_normalized: workspacePathNormalized,
    repo_root: repoRoot,
    repo_remote: repoRemote,
    repo_fingerprint: repoFingerprint,
    source_native_project_ref: asOptionalString(evidence.source_native_project_ref),
    evidence,
    host_id: session.host_id,
    source_platform: session.source_platform,
    workspace_subpath: deriveWorkspaceSubpath(workspacePathNormalized, repoRoot),
  };
}

function classifyObservation(observation: LinkedProjectObservation): ObservationLinkRule | undefined {
  const workspaceIdentity = observation.workspace_subpath ?? observation.workspace_path_normalized;

  if (observation.repo_fingerprint && workspaceIdentity) {
    return {
      linkage_state: "committed",
      reason: "repo_fingerprint_match",
      confidence: 0.95,
      key: `fingerprint:${observation.repo_fingerprint}|workspace:${workspaceIdentity}`,
    };
  }

  if (observation.repo_remote && observation.host_id && workspaceIdentity) {
    return {
      linkage_state: "committed",
      reason: "repo_remote_match",
      confidence: 0.85,
      key: `host:${observation.host_id}|remote:${observation.repo_remote}|workspace:${workspaceIdentity}`,
    };
  }

  if (observation.source_native_project_ref && observation.host_id) {
    return {
      linkage_state: "candidate",
      reason: "source_native_project",
      confidence: 0.7,
      key: `host:${observation.host_id}|native:${observation.source_native_project_ref}`,
    };
  }

  if (observation.workspace_path_normalized && observation.host_id) {
    return {
      linkage_state: "candidate",
      reason: isWeakWorkspacePath(observation.workspace_path_normalized) ? "weak_path_hint" : "workspace_path_continuity",
      confidence: isWeakWorkspacePath(observation.workspace_path_normalized) ? 0.42 : 0.55,
      key: `host:${observation.host_id}|workspace:${observation.workspace_path_normalized}`,
    };
  }

  if (observation.repo_remote && observation.host_id) {
    return {
      linkage_state: "candidate",
      reason: "metadata_hint",
      confidence: 0.6,
      key: `host:${observation.host_id}|remote_hint:${observation.repo_remote}`,
    };
  }

  return undefined;
}

function buildProjectIdentity(group: ProjectGroup): ProjectIdentity {
  const primaryWorkspacePath = pickMostCommon(group.observations.map((observation) => observation.workspace_path_normalized));
  const repoRoot = pickMostCommon(group.observations.map((observation) => observation.repo_root));
  const repoRemote = pickMostCommon(group.observations.map((observation) => observation.repo_remote));
  const repoFingerprint = pickMostCommon(group.observations.map((observation) => observation.repo_fingerprint));
  const sourceNativeProjectRef = pickMostCommon(
    group.observations.map((observation) => observation.source_native_project_ref),
  );
  const createdAt = minIso(group.observations.map((observation) => observation.observed_at)) ?? nowIso();
  const updatedAt = maxIsoFrom(group.observations.map((observation) => observation.observed_at)) ?? createdAt;
  const displayName = deriveDisplayName(primaryWorkspacePath, repoRoot, repoRemote, group.observations);
  const slugBase = slugify(displayName) || "project";

  return {
    project_id: group.project_id,
    project_revision_id: group.project_revision_id,
    display_name: displayName,
    slug: `${slugBase}-${group.project_id.slice(-6)}`,
    linkage_state: group.linkage_state,
    confidence: group.confidence,
    link_reason: group.reason,
    manual_override_status: "none",
    primary_workspace_path: primaryWorkspacePath,
    source_native_project_ref: sourceNativeProjectRef,
    repo_root: repoRoot,
    repo_remote: repoRemote,
    repo_fingerprint: repoFingerprint,
    source_platforms: uniqueStrings(group.observations.map((observation) => observation.source_platform)) as SourcePlatform[],
    host_ids: uniqueStrings(group.observations.map((observation) => observation.host_id)),
    committed_turn_count: 0,
    candidate_turn_count: 0,
    session_count: 0,
    project_last_activity_at: updatedAt,
    created_at: createdAt,
    updated_at: updatedAt,
  };
}

function deriveProjectGroupConfidence(group: ProjectGroup): number {
  if (group.linkage_state === "committed") {
    return roundConfidence(group.confidence);
  }

  const sessionCount = new Set(group.observations.map((observation) => observation.session_ref)).size;
  const platformCount = new Set(group.observations.map((observation) => observation.source_platform)).size;
  const hasRepoRoot = group.observations.some((observation) => Boolean(observation.repo_root));

  if (group.reason === "workspace_path_continuity") {
    let confidence = 0.68;
    if (sessionCount >= 2) {
      confidence += 0.12;
    }
    if (sessionCount >= 3) {
      confidence += 0.05;
    }
    if (platformCount >= 2) {
      confidence += 0.03;
    }
    if (hasRepoRoot) {
      confidence += 0.03;
    }
    return clampConfidence(confidence, 0.68, 0.88);
  }

  if (group.reason === "source_native_project") {
    let confidence = 0.72;
    if (sessionCount >= 2) {
      confidence += 0.08;
    }
    if (sessionCount >= 3) {
      confidence += 0.04;
    }
    if (platformCount >= 2) {
      confidence += 0.03;
    }
    return clampConfidence(confidence, 0.72, 0.87);
  }

  if (group.reason === "metadata_hint") {
    let confidence = 0.6;
    if (sessionCount >= 2) {
      confidence += 0.08;
    }
    if (platformCount >= 2) {
      confidence += 0.04;
    }
    return clampConfidence(confidence, 0.6, 0.78);
  }

  if (group.reason === "weak_path_hint") {
    let confidence = 0.42;
    if (sessionCount >= 2) {
      confidence += 0.08;
    }
    if (sessionCount >= 3) {
      confidence += 0.04;
    }
    if (platformCount >= 2) {
      confidence += 0.03;
    }
    return clampConfidence(confidence, 0.42, 0.6);
  }

  return roundConfidence(group.confidence);
}

function decorateTurn(
  turn: UserTurnProjection,
  observations: LinkedProjectObservation[],
  projectById: Map<string, ProjectIdentity>,
  manualOverride?: ProjectManualOverride,
): UserTurnProjection {
  if (manualOverride) {
    const project = projectById.get(manualOverride.project_id) ?? buildManualProjectIdentity(manualOverride);
    projectById.set(project.project_id, project);
    return {
      ...turn,
      project_id: project.project_id,
      project_ref: project.slug,
      link_state: "committed",
      project_link_state: "committed",
      project_confidence: 1,
      candidate_project_ids: [project.project_id],
    };
  }

  const linkedObservations = observations.filter((observation) => observation.project_id && observation.linkage_state);
  if (linkedObservations.length === 0) {
    return turn;
  }

  const selectedObservation = selectObservationForTurn(turn, linkedObservations);
  if (!selectedObservation?.project_id) {
    return turn;
  }

  const project = projectById.get(selectedObservation.project_id);
  if (!project) {
    return turn;
  }

  const candidateProjectIds = uniqueStrings(
    linkedObservations
      .map((observation) => observation.project_id)
      .filter((projectId): projectId is string => Boolean(projectId)),
  );

  return {
    ...turn,
    project_id: project.project_id,
    project_ref: project.slug,
    link_state: project.linkage_state,
    project_link_state: project.linkage_state,
    project_confidence: project.confidence,
    candidate_project_ids: project.linkage_state === "candidate" ? candidateProjectIds : undefined,
  };
}

function decorateSession(session: SessionProjection, turns: UserTurnProjection[]): SessionProjection {
  const preferredTurn = selectPrimaryProjectTurn(turns);
  if (!preferredTurn?.project_id) {
    return session;
  }

  return {
    ...session,
    primary_project_id: preferredTurn.project_id,
  };
}

function selectObservationForTurn(
  turn: UserTurnProjection,
  observations: LinkedProjectObservation[],
): LinkedProjectObservation | undefined {
  const sorted = [...observations].sort((left, right) => left.observed_at.localeCompare(right.observed_at));
  let selected = sorted[0];

  for (const observation of sorted) {
    if (observation.observed_at <= turn.last_context_activity_at) {
      selected = observation;
      continue;
    }
    break;
  }

  return selected;
}

function selectPrimaryProjectTurn(turns: UserTurnProjection[]): DecoratedTurn | undefined {
  const linkedTurns = turns.filter((turn): turn is DecoratedTurn & { project_id: string } => Boolean(turn.project_id));
  if (linkedTurns.length === 0) {
    return undefined;
  }

  const committedTurns = linkedTurns.filter((turn) => turn.link_state === "committed");
  const pool = committedTurns.length > 0 ? committedTurns : linkedTurns;
  return [...pool].sort((left, right) => right.last_context_activity_at.localeCompare(left.last_context_activity_at))[0];
}

function deriveWorkspaceSubpath(workspacePath: string | undefined, repoRoot: string | undefined): string | undefined {
  if (!workspacePath || !repoRoot) {
    return undefined;
  }
  if (workspacePath === repoRoot) {
    return ".";
  }
  if (!workspacePath.startsWith(`${repoRoot}/`)) {
    return undefined;
  }
  return workspacePath.slice(repoRoot.length + 1) || ".";
}

function deriveDisplayName(
  primaryWorkspacePath: string | undefined,
  repoRoot: string | undefined,
  repoRemote: string | undefined,
  observations: readonly LinkedProjectObservation[],
): string {
  const repoName = deriveRepoName(repoRemote, repoRoot);
  const workspaceSubpath = pickMostCommon(observations.map((observation) => observation.workspace_subpath));

  if (repoName && workspaceSubpath && workspaceSubpath !== ".") {
    return `${repoName}/${workspaceSubpath}`;
  }

  if (primaryWorkspacePath) {
    return path.posix.basename(primaryWorkspacePath) || primaryWorkspacePath;
  }

  if (repoName) {
    return repoName;
  }

  return pickMostCommon(observations.map((observation) => observation.source_native_project_ref)) ?? "project";
}

function deriveRepoName(repoRemote: string | undefined, repoRoot: string | undefined): string | undefined {
  if (repoRemote) {
    const trimmed = repoRemote.replace(/\/+$/, "");
    return decodeUriLabel(trimmed.split("/").filter(Boolean).at(-1));
  }
  if (repoRoot) {
    return decodeUriLabel(path.posix.basename(repoRoot) || repoRoot);
  }
  return undefined;
}

function stableProjectId(key: string): string {
  return `project-${createHash("sha1").update(key).digest("hex").slice(0, 12)}`;
}

function buildManualProjectIdentity(override: ProjectManualOverride): ProjectIdentity {
  const createdAt = override.created_at;
  const slugBase = slugify(override.display_name) || "project";
  return {
    project_id: override.project_id,
    project_revision_id: `${override.project_id}:r1`,
    display_name: override.display_name,
    slug: `${slugBase}-${override.project_id.slice(-6)}`,
    linkage_state: "committed",
    confidence: 1,
    link_reason: "manual_override",
    manual_override_status: "applied",
    source_platforms: [],
    host_ids: [],
    committed_turn_count: 0,
    candidate_turn_count: 0,
    session_count: 0,
    project_last_activity_at: createdAt,
    created_at: createdAt,
    updated_at: override.updated_at,
  };
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function uniqueStrings<T extends string>(values: readonly (T | undefined)[]): T[] {
  return [...new Set(values.filter((value): value is T => Boolean(value)))].sort();
}

function pickMostCommon<T extends string>(values: readonly (T | undefined)[]): T | undefined {
  const counts = new Map<T, number>();

  for (const value of values) {
    if (!value) {
      continue;
    }
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  let selected: T | undefined;
  let maxCount = -1;
  for (const [value, count] of counts.entries()) {
    if (count > maxCount) {
      selected = value;
      maxCount = count;
    }
  }

  return selected;
}

function minIso(values: readonly (string | undefined)[]): string | undefined {
  return [...values].filter((value): value is string => Boolean(value)).sort()[0];
}

function maxIso(current: string | undefined, candidate: string | undefined): string | undefined {
  if (!current) {
    return candidate;
  }
  if (!candidate) {
    return current;
  }
  return current >= candidate ? current : candidate;
}

function maxIsoFrom(values: readonly (string | undefined)[]): string | undefined {
  return [...values].filter((value): value is string => Boolean(value)).sort().at(-1);
}

function clampConfidence(value: number, min: number, max: number): number {
  return roundConfidence(Math.min(max, Math.max(min, value)));
}

function roundConfidence(value: number): number {
  return Math.round(value * 100) / 100;
}

function normalizePathKey(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const normalized = decodeUriPath(value).replace(/\\/g, "/").replace(/\/+/g, "/");
  if (normalized.length > 1 && normalized.endsWith("/")) {
    return normalized.slice(0, -1);
  }
  return normalized;
}

function decodeUriPath(value: string): string {
  if (!/%[0-9a-f]{2}/iu.test(value)) {
    return value;
  }
  try {
    return decodeURI(value);
  } catch {
    return value;
  }
}

function decodeUriLabel(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  return decodeUriPath(value);
}

function isWeakWorkspacePath(workspacePath: string): boolean {
  const normalized = workspacePath.replace(/\\/g, "/").toLowerCase();
  const basename = path.posix.basename(normalized);

  if (normalized === "/root" || normalized === "/tmp" || normalized.startsWith("/tmp/")) {
    return true;
  }

  if (/^[a-z]:\/(?:temp|tmp)(?:\/|$)/.test(normalized)) {
    return true;
  }

  if (normalized.includes("/appdata/local/temp/") || normalized.endsWith("/appdata/local/temp")) {
    return true;
  }

  if (
    normalized.includes("/.config/aionui/aionui/claude-temp-") ||
    normalized.includes("/.config/aionui/aionui/codex-temp-")
  ) {
    return true;
  }

  return (
    basename === "tmp" ||
    basename === "temp" ||
    basename === "scratchpad" ||
    basename.startsWith("claude-temp-") ||
    basename.startsWith("codex-temp-")
  );
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function asOptionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function nowIso(): string {
  return new Date().toISOString();
}

function compareProjectsByActivityDesc(left: ProjectIdentity, right: ProjectIdentity): number {
  return compareConfidenceThenRecencyDesc(
    left.linkage_state === "committed" ? 1 : 0,
    right.linkage_state === "committed" ? 1 : 0,
    left.project_last_activity_at ?? left.updated_at,
    right.project_last_activity_at ?? right.updated_at,
  );
}

function compareConfidenceThenRecencyDesc(
  leftConfidence: number,
  rightConfidence: number,
  leftTimestamp: string | undefined,
  rightTimestamp: string | undefined,
): number {
  if (leftConfidence !== rightConfidence) {
    return rightConfidence - leftConfidence;
  }
  if (leftTimestamp && rightTimestamp && leftTimestamp !== rightTimestamp) {
    return rightTimestamp.localeCompare(leftTimestamp);
  }
  if (leftTimestamp && !rightTimestamp) {
    return -1;
  }
  if (!leftTimestamp && rightTimestamp) {
    return 1;
  }
  return 0;
}
