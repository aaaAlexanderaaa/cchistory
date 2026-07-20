import type { ProjectIdentity, SessionProjection, UserTurnProjection } from "@cchistory/domain";

export function buildProjectDisplayList(projects: readonly ProjectIdentity[]): ProjectIdentity[] {
  return projects
    .filter((project) => project.committed_turn_count + project.candidate_turn_count > 0)
    .sort((left, right) => {
      const leftTurns = left.committed_turn_count + left.candidate_turn_count;
      const rightTurns = right.committed_turn_count + right.candidate_turn_count;
      if (leftTurns !== rightTurns) {
        return rightTurns - leftTurns;
      }
      if (left.session_count !== right.session_count) {
        return right.session_count - left.session_count;
      }
      const activityCompare = (right.project_last_activity_at ?? right.updated_at).localeCompare(
        left.project_last_activity_at ?? left.updated_at,
      );
      if (activityCompare !== 0) {
        return activityCompare;
      }
      return left.display_name.localeCompare(right.display_name) || left.project_id.localeCompare(right.project_id);
    });
}

export function compareSessionsByRecency(left: SessionProjection, right: SessionProjection): number {
  return (
    right.updated_at.localeCompare(left.updated_at) ||
    right.created_at.localeCompare(left.created_at) ||
    left.id.localeCompare(right.id)
  );
}

export function compareTurnsByRecency(left: UserTurnProjection, right: UserTurnProjection): number {
  return (
    right.submission_started_at.localeCompare(left.submission_started_at) ||
    right.created_at.localeCompare(left.created_at) ||
    left.id.localeCompare(right.id)
  );
}

export function compareTurnsByChronology(left: UserTurnProjection, right: UserTurnProjection): number {
  return (
    left.submission_started_at.localeCompare(right.submission_started_at) ||
    left.created_at.localeCompare(right.created_at) ||
    left.id.localeCompare(right.id)
  );
}
