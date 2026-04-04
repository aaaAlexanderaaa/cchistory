import type {
  ProjectIdentity,
  ProjectLineageEvent,
  ProjectLinkRevision,
} from "@cchistory/domain";
import { compositeKey } from "../internal/utils.js";

export function assignProjectRevisions(
  nextProjects: ProjectIdentity[],
  existingProjects: ProjectIdentity[],
): {
  projects: ProjectIdentity[];
  revisions: ProjectLinkRevision[];
  lineageEvents: ProjectLineageEvent[];
} {
  const existingById = new Map(existingProjects.map((project) => [project.project_id, project]));
  const revisions: ProjectLinkRevision[] = [];
  const lineageEvents: ProjectLineageEvent[] = [];
  const projects = nextProjects.map((project) => {
    const existing = existingById.get(project.project_id);
    const changed = !existing || projectSignature(existing) !== projectSignature(project);
    if (!existing) {
      const initialProject = {
        ...project,
        project_revision_id: `${project.project_id}:r1`,
      };
      revisions.push(projectToRevision(initialProject));
      lineageEvents.push({
        id: compositeKey("project-lineage", initialProject.project_id, initialProject.project_revision_id, "created"),
        project_id: initialProject.project_id,
        project_revision_id: initialProject.project_revision_id,
        event_kind: "created",
        created_at: initialProject.updated_at,
        detail: {
          link_reason: initialProject.link_reason,
          manual_override_status: initialProject.manual_override_status,
        },
      });
      return initialProject;
    }

    if (!changed) {
      return {
        ...project,
        project_revision_id: existing.project_revision_id,
        created_at: existing.created_at,
      };
    }

    const nextRevisionId = incrementProjectRevisionId(existing.project_revision_id);
    const revisedProject = {
      ...project,
      project_revision_id: nextRevisionId,
      created_at: existing.created_at,
    };
    revisions.push(projectToRevision(revisedProject, existing.project_revision_id));
    lineageEvents.push({
      id: compositeKey("project-lineage", revisedProject.project_id, nextRevisionId, "revised"),
      project_id: revisedProject.project_id,
      project_revision_id: nextRevisionId,
      previous_project_revision_id: existing.project_revision_id,
      event_kind: revisedProject.link_reason === "manual_override" ? "manual_override" : "revised",
      created_at: revisedProject.updated_at,
      detail: {
        previous_link_reason: existing.link_reason,
        next_link_reason: revisedProject.link_reason,
        previous_manual_override_status: existing.manual_override_status,
        next_manual_override_status: revisedProject.manual_override_status,
      },
    });
    lineageEvents.push({
      id: compositeKey("project-lineage", revisedProject.project_id, existing.project_revision_id, "superseded"),
      project_id: revisedProject.project_id,
      project_revision_id: existing.project_revision_id,
      previous_project_revision_id: nextRevisionId,
      event_kind: "superseded",
      created_at: revisedProject.updated_at,
      detail: {
        superseded_by_project_revision_id: nextRevisionId,
      },
    });
    return revisedProject;
  });

  return { projects, revisions, lineageEvents };
}

function projectToRevision(project: ProjectIdentity, previousRevisionId?: string): ProjectLinkRevision {
  return {
    id: project.project_revision_id,
    project_id: project.project_id,
    project_revision_id: project.project_revision_id,
    linkage_state: project.linkage_state,
    confidence: project.confidence,
    link_reason: project.link_reason,
    manual_override_status: project.manual_override_status,
    observation_refs: [],
    supersedes_project_revision_id: previousRevisionId,
    created_at: project.updated_at,
  };
}

function projectSignature(project: ProjectIdentity): string {
  return JSON.stringify({
    ...project,
    project_revision_id: undefined,
    created_at: undefined,
  });
}

function incrementProjectRevisionId(currentRevisionId: string): string {
  const match = currentRevisionId.match(/^(.*):r(\d+)$/);
  if (!match) {
    return `${currentRevisionId}:r2`;
  }
  return `${match[1]}:r${Number(match[2]) + 1}`;
}
