import type { CCHistoryStorage } from "@cchistory/storage";
import {
  formatNumber,
  renderKeyValue,
  renderSection,
  renderTable,
} from "../renderers.js";
import { type StoreLayout, openStorage, resolveStoreLayout } from "../store.js";
import {
  type CommandContext,
  type CommandOutput,
  isMissingPathError,
  pathExists,
} from "../main.js";

export async function handleStatus(context: CommandContext): Promise<CommandOutput> {
  const layout = resolveStoreLayout({
    cwd: context.io.cwd,
    storeArg: context.globals.store,
    dbArg: context.globals.db,
  });
  const storeExists = await pathExists(layout.dbPath);

  if (!storeExists) {
    return renderMissingStoreStatus(layout);
  }

  const storage = await openStorage(layout);
  try {
    return renderStatusReport(layout, storage);
  } finally {
    storage.close();
  }
}

function renderMissingStoreStatus(layout: StoreLayout): CommandOutput {
  return {
    text: [
      renderSection(
        "CCHistory Status",
        renderKeyValue([
          ["DB", layout.dbPath],
          ["Store Present", "no"],
        ]),
      ),
      "",
      "No store found at the resolved location. To get started:",
      "  - Run `cchistory sync` to ingest history from local AI coding tools (Claude Code, Codex, Cursor, AMP, ...).",
      "  - Run `cchistory discover` to see which sources are detectable on this machine.",
      "  - Use `--store <dir>` or `--db <path>` to point at a non-default store.",
    ].join("\n"),
    json: {
      kind: "status",
      db_path: layout.dbPath,
      store_present: false,
    },
  };
}

function renderStatusReport(layout: StoreLayout, storage: CCHistoryStorage): CommandOutput {
  const schema = storage.getSchemaInfo();
  const overview = storage.getUsageOverview({ include_known_zero_token: false });
  const sources = storage.listSources();
  const sessions = storage.listResolvedSessions();
  const turns = storage.listResolvedTurns();
  const projects = storage.listProjects();

  const healthy = sources.filter((s) => s.sync_status === "healthy").length;
  const stale = sources.filter((s) => s.sync_status === "stale").length;
  const errorSources = sources.filter((s) => s.sync_status === "error").length;

  let latestSync: string | undefined;
  for (const source of sources) {
    if (!source.last_sync) continue;
    if (!latestSync || source.last_sync > latestSync) latestSync = source.last_sync;
  }

  const issues: string[] = [];
  if (errorSources > 0) issues.push(`${errorSources} source(s) in error state — run \`cchistory doctor\` for details.`);
  if (stale > 0 && healthy === 0) issues.push("All sources stale — run `cchistory sync` to refresh.");
  if (overview.turns_with_token_usage < overview.total_turns * 0.5 && overview.total_turns > 10) {
    issues.push("Token coverage below 50% — some sessions may predate usage tracking.");
  }

  const nextActions = recommendNextActions({
    storeExists: true,
    sourcesCount: sources.length,
    errorSources,
    staleSources: stale,
    healthySources: healthy,
  });

  return {
    text: [
      renderSection(
        "CCHistory Status",
        renderKeyValue([
          ["DB", layout.dbPath],
          ["Store Present", "yes"],
          ["Schema Version", schema.schema_version],
          ["Schema Migrations", String(schema.migrations.length)],
          ["Search Mode", storage.searchMode],
          ["Latest Sync", latestSync ?? "(never)"],
        ]),
      ),
      "",
      renderSection(
        "Counts",
        renderKeyValue([
          ["Sources", formatNumber(sources.length)],
          ["Projects", formatNumber(projects.length)],
          ["Sessions", formatNumber(sessions.length)],
          ["Turns", formatNumber(turns.length)],
          ["Turns With Tokens", `${formatNumber(overview.turns_with_token_usage)}/${formatNumber(overview.total_turns)}`],
          ["Total Tokens", formatNumber(overview.total_tokens)],
        ]),
      ),
      "",
      renderSection(
        "Source Health",
        renderKeyValue([
          ["Healthy", String(healthy)],
          ["Stale", String(stale)],
          ["Error", String(errorSources)],
        ]),
      ),
      issues.length > 0
        ? ["", renderSection("Issues", issues.map((line) => `- ${line}`).join("\n"))].join("\n")
        : "",
      "",
      renderSection("Next Actions", nextActions.map((action) => `- ${action}`).join("\n")),
    ]
      .filter((line) => line !== "")
      .join("\n"),
    json: {
      kind: "status",
      db_path: layout.dbPath,
      store_present: true,
      schema,
      search_mode: storage.searchMode,
      latest_sync: latestSync ?? null,
      counts: {
        sources: sources.length,
        projects: projects.length,
        sessions: sessions.length,
        turns: turns.length,
      },
      source_health: {
        healthy,
        stale,
        error: errorSources,
      },
      overview,
      issues,
      next_actions: nextActions,
    },
  };
}

function recommendNextActions(input: {
  storeExists: boolean;
  sourcesCount: number;
  errorSources: number;
  staleSources: number;
  healthySources: number;
}): string[] {
  if (!input.storeExists || input.sourcesCount === 0) {
    return [
      "Run `cchistory sync` to ingest history from local AI coding tools.",
      "Run `cchistory discover` to see which sources are detectable on this machine.",
    ];
  }
  const actions: string[] = [];
  if (input.errorSources > 0) {
    actions.push("Run `cchistory doctor` to investigate sources in error state.");
  }
  if (input.staleSources > 0 || input.healthySources === 0) {
    actions.push("Run `cchistory sync` to refresh stale sources.");
  }
  actions.push("Run `cchistory stats` for token-usage rollups by model/project/source.");
  actions.push("Run `cchistory ls projects` to browse ingested projects.");
  actions.push("Run `cchistory search <query>` to find an old ask by text.");
  return actions;
}
