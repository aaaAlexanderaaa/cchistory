import type { CommandContext, CommandOutput } from "../main.js";
import { openReadStore } from "../main.js";
import { resolveProjectRef } from "../resolvers.js";
import { usageError } from "../errors.js";
import { bold, dim, cyan, muted } from "../colors.js";
import { truncateText } from "../renderers.js";

interface ResumeCard {
  project: {
    id: string;
    slug: string;
    display_name: string;
    workspace?: string;
  };
  latest_session?: {
    id: string;
    title?: string;
    workspace?: string;
    turn_count: number;
  };
  latest_turn?: {
    id: string;
    submission_started_at: string;
    canonical_text: string;
  };
  resume_hint: {
    tui_command: string;
    next_actions: string[];
  };
}

export async function handleResume(context: CommandContext): Promise<CommandOutput> {
  const ref = context.positionals[0]?.trim();
  if (!ref) {
    throw usageError(
      "Provide a project reference (id, slug, name, or workspace). Example: cchistory resume my-app",
    );
  }

  const openTui = Boolean(context.options.tui);

  const readStore = await openReadStore(context);
  try {
    const { storage } = readStore;
    let project;
    try {
      project = resolveProjectRef(storage, ref);
    } catch (error) {
      // resolveProjectRef throws plain Error for unknown/ambiguous refs; we
      // surface them as usage errors so the exit code reflects the user's
      // argument mistake rather than a runtime fault.
      throw usageError(error instanceof Error ? error.message : String(error));
    }
    const turns = storage.listProjectTurnsForReadSurface(project.project_id, "all");

    if (turns.length === 0) {
      throw usageError(
        `Project ${JSON.stringify(project.display_name)} (${project.project_id}) has no turns yet. Run \`cchistory sync\` to ingest recent activity.`,
      );
    }

    // listProjectTurnsForReadSurface sorts by session DESC + turn ASC within a
    // session, so turns[0] is the FIRST ask of the latest session — not the
    // latest activity. Pick the turn with the maximum submission_started_at
    // across the whole project so `--tui` and the printed card point at the
    // operator's actual most recent work.
    const latestTurn = turns.reduce((latest, current) =>
      current.submission_started_at > latest.submission_started_at ? current : latest,
    )!;
    const session = storage.getSession(latestTurn.session_id);

    const card: ResumeCard = {
      project: {
        id: project.project_id,
        slug: project.slug,
        display_name: project.display_name,
        workspace: project.primary_workspace_path,
      },
      latest_session: session
        ? {
          id: session.id,
          title: session.title,
          workspace: session.working_directory,
          turn_count: storage.listSessionTurnsForReadSurface(session.id).length,
        }
        : undefined,
      latest_turn: {
        id: latestTurn.id,
        submission_started_at: latestTurn.submission_started_at,
        canonical_text: latestTurn.canonical_text,
      },
      resume_hint: {
        tui_command: `cchistory tui --turn ${latestTurn.id}`,
        next_actions: [
          `cchistory show turn ${latestTurn.id}`,
          `cchistory tree session ${latestTurn.session_id}`,
          `cchistory resume ${project.slug} --tui`,
        ],
      },
    };

    if (openTui) {
      // Forward to the TUI with --turn set; we exit with the TUI's exit code.
      // We do this by mutating context.commandPath and re-dispatching.
      // Defense in depth: the parser-level assertNonInteractive should already
      // have caught --non-interactive / --agent, but reject here too so
      // programmatic callers (which bypass the parser) cannot hang on the TUI.
      if (context.globals.nonInteractive) {
        throw usageError(
          "`resume --tui` requires an interactive terminal. Drop --non-interactive / --agent, or omit --tui to print the resume card.",
        );
      }
      const tuiContext: CommandContext = {
        ...context,
        commandPath: ["tui"],
        positionals: [],
        options: { ...context.options, turn: latestTurn.id },
      };
      const { handleTui } = await import("../main.js");
      return handleTui(tuiContext);
    }

    const text = renderResumeCardText(card);
    return { text, json: card };
  } finally {
    await readStore.close();
  }
}

/**
 * `cchistory last [project-ref]` — shortcut for `resume`. Without a ref,
 * picks the most recently active project (sorted by project_last_activity_at
 * desc, then committed+candidate turn count). Convenient for "what was I
 * working on?".
 */
export async function handleLast(context: CommandContext): Promise<CommandOutput> {
  if (context.positionals[0]) {
    return handleResume(context);
  }
  const readStore = await openReadStore(context);
  try {
    const { storage } = readStore;
    const projects = storage.listProjects();
    if (projects.length === 0) {
      throw usageError(
        "No projects are indexed yet. Run `cchistory sync` to ingest from local AI coding tools.",
      );
    }
    const recent = projects
      .filter((project) => (project.committed_turn_count + project.candidate_turn_count) > 0)
      .sort((a, b) => {
        const activityA = a.project_last_activity_at ?? "";
        const activityB = b.project_last_activity_at ?? "";
        if (activityA !== activityB) return activityB.localeCompare(activityA);
        const turnsA = a.committed_turn_count + a.candidate_turn_count;
        const turnsB = b.committed_turn_count + b.candidate_turn_count;
        return turnsB - turnsA;
      });
    const target = recent[0];
    if (!target) {
      throw usageError(
        "Projects are indexed but none have turns yet. Run `cchistory sync` to ingest recent activity.",
      );
    }
    const delegated: CommandContext = {
      ...context,
      commandPath: ["resume"],
      positionals: [target.project_id],
    };
    return handleResume(delegated);
  } finally {
    await readStore.close();
  }
}

function renderResumeCardText(card: ResumeCard): string {
  const lines: string[] = [];
  lines.push(bold(cyan(`Resume: ${card.project.display_name}`)));
  lines.push(dim(`project_id=${card.project.id}  slug=${card.project.slug}`));
  if (card.project.workspace) {
    lines.push(muted(`workspace: ${card.project.workspace}`));
  }
  lines.push("");

  if (card.latest_session) {
    lines.push(bold("Latest session"));
    lines.push(`  id: ${card.latest_session.id}`);
    if (card.latest_session.title) {
      lines.push(`  title: ${truncateText(card.latest_session.title, 80)}`);
    }
    if (card.latest_session.workspace) {
      lines.push(`  workspace: ${card.latest_session.workspace}`);
    }
    lines.push(`  turns: ${card.latest_session.turn_count}`);
    lines.push("");
  }

  if (card.latest_turn) {
    lines.push(bold("Latest turn"));
    lines.push(`  id: ${card.latest_turn.id}`);
    lines.push(`  submitted: ${card.latest_turn.submission_started_at}`);
    lines.push(`  prompt: ${truncateText(card.latest_turn.canonical_text, 120)}`);
    lines.push("");
  }

  lines.push(bold("Resume"));
  for (const action of card.resume_hint.next_actions) {
    lines.push(`  $ ${action}`);
  }
  lines.push(dim(`  TUI: $ ${card.resume_hint.tui_command}`));
  return lines.join("\n");
}
