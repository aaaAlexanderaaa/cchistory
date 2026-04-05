import type { DriftTimelinePoint, UserTurnProjection } from "@cchistory/domain";

export function buildDriftTimeline(
  turns: UserTurnProjection[],
  consistencyScore: number,
  globalDriftIndex: number,
): DriftTimelinePoint[] {
  const turnsByDay = new Map<string, number>();
  for (const turn of turns) {
    const day = turn.submission_started_at.slice(0, 10);
    turnsByDay.set(day, (turnsByDay.get(day) ?? 0) + 1);
  }

  const today = new Date();
  const timeline: DriftTimelinePoint[] = [];
  let runningTotal = 0;
  for (let offset = 6; offset >= 0; offset -= 1) {
    const date = new Date(today);
    date.setUTCDate(date.getUTCDate() - offset);
    const day = date.toISOString().slice(0, 10);
    runningTotal += turnsByDay.get(day) ?? 0;
    timeline.push({
      date: day,
      global_drift_index: globalDriftIndex,
      consistency_score: consistencyScore,
      total_turns: runningTotal,
    });
  }
  return timeline;
}

export { clamp01 } from "../internal/utils.js";
