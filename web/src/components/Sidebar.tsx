import type { Mode, SourceInfo } from "../types";
import type { Language, UiCopy } from "../i18n";
import type { PromptInjectionTemplate } from "../messageDisplay";
import MessageTemplateSettings from "./MessageTemplateSettings";

interface SidebarProps {
  mode: Mode;
  language: Language;
  locale: string;
  copy: UiCopy;
  totalProjects: number;
  activeFilterCount: number;
  promptTemplates: PromptInjectionTemplate[];
  onLanguageChange: (language: Language) => void;
  onPromptTemplatesChange: (templates: PromptInjectionTemplate[]) => void;
  onModeChange: (mode: Mode) => void;
  sources: SourceInfo[];
  selectedSource: string | null;
  onSelectSource: (sourceId: string | null) => void;
  projects: Record<string, string[]>;
  selectedProject: string | null;
  onSelectProject: (project: string | null) => void;
}

function lagLabel(lagSeconds: number | undefined, language: Language): string | null {
  if (lagSeconds == null) return null;
  if (language === "zh-CN") {
    if (lagSeconds < 60) return `${lagSeconds} 秒延迟`;
    if (lagSeconds < 3600) return `${Math.round(lagSeconds / 60)} 分钟延迟`;
    return `${Math.round(lagSeconds / 3600)} 小时延迟`;
  }
  if (lagSeconds < 60) return `${lagSeconds}s lag`;
  if (lagSeconds < 3600) return `${Math.round(lagSeconds / 60)}m lag`;
  return `${Math.round(lagSeconds / 3600)}h lag`;
}

function statusTone(status: string): string {
  if (status === "ok" || status === "connected") return "bg-emerald-500";
  if (status === "degraded") return "bg-amber-500";
  if (status === "disabled") return "bg-slate-500";
  return "bg-rose-500";
}

function statusLabel(status: string, labels: UiCopy["statusLabels"]): string {
  return labels[status.toLowerCase()] ?? status;
}

export default function Sidebar({
  mode,
  language,
  locale,
  copy,
  totalProjects,
  activeFilterCount,
  promptTemplates,
  onLanguageChange,
  onPromptTemplatesChange,
  onModeChange,
  sources,
  selectedSource,
  onSelectSource,
  projects,
  selectedProject,
  onSelectProject,
}: SidebarProps) {
  const numberFormatter = new Intl.NumberFormat(locale);
  const hasActiveFilters = activeFilterCount > 0;
  const totalIndexedEntries = sources.reduce(
    (total, source) => total + (source.entry_count ?? 0),
    0
  );
  const selectedSourceName =
    sources.find((source) => source.source_id === selectedSource)?.name ?? selectedSource;
  const scopedProjectKeys = Array.from(
    new Set([selectedSource, selectedSourceName].filter((value): value is string => Boolean(value)))
  );
  const visibleProjects = selectedSource
    ? scopedProjectKeys.flatMap((sourceKey) =>
        (projects[sourceKey] ?? []).map((project) => ({
          sourceName: selectedSourceName ?? sourceKey,
          project,
        }))
      )
    : Object.entries(projects).flatMap(([sourceName, sourceProjects]) =>
        sourceProjects.map((project) => ({
          sourceName,
          project,
        }))
      );

  return (
    <aside className="app-card flex flex-col gap-5 p-5 lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto">
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-2">
            <p className="text-[11px] font-bold uppercase tracking-[0.3em] text-[var(--accent)]">
              {copy.sidebar.eyebrow}
            </p>
            <div>
              <h1 className="font-display text-2xl font-bold text-slate-100">
                {copy.sidebar.title}
              </h1>
              <p className="mt-1 text-sm leading-6 text-[var(--text-secondary)]">
                {copy.sidebar.description}
              </p>
            </div>
          </div>
          <div className="space-y-2 text-right">
            <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--text-muted)]">
              {copy.language.label}
            </div>
            <div className="inline-toggle">
              {(["en", "zh-CN"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => onLanguageChange(option)}
                  className={`inline-toggle-button ${
                    language === option ? "is-active" : ""
                  }`}
                >
                  {copy.language.options[option]}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="h-px bg-gradient-to-r from-[var(--accent)] via-[var(--accent-medium)] to-transparent" />

        <section className="space-y-3">
          <div className="section-kicker">{copy.sidebar.overview}</div>
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
            <div className="stat-card">
              <div className="stat-label">{copy.sidebar.sources}</div>
              <div className="stat-value">{numberFormatter.format(sources.length)}</div>
              <div className="mt-1 text-xs text-[var(--text-muted)]">
                {numberFormatter.format(totalIndexedEntries)} {copy.sidebar.indexed}
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-label">{copy.sidebar.projects}</div>
              <div className="stat-value">{numberFormatter.format(totalProjects)}</div>
              <div className="mt-1 text-xs text-[var(--text-muted)]">{copy.sidebar.scopes}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">{copy.sidebar.filters}</div>
              <div className="stat-value">{numberFormatter.format(activeFilterCount)}</div>
              <div className="mt-1 text-xs text-[var(--text-muted)]">
                {hasActiveFilters ? copy.sidebar.reset : copy.filters.noFilters}
              </div>
            </div>
          </div>
        </section>
      </div>

      <section className="space-y-2">
        <div className="section-kicker">{copy.sidebar.modes}</div>
        <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-1">
          {(["explore", "search", "distill"] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => onModeChange(option)}
              className={`mode-button ${mode === option ? "is-active" : ""}`}
            >
              <span className="text-sm font-semibold">{copy.modeLabels[option]}</span>
              <span className="text-xs opacity-60">{copy.modeCaptions[option]}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="section-kicker">{copy.sidebar.sourceSection}</div>
          <button
            type="button"
            onClick={() => {
              onSelectSource(null);
              onSelectProject(null);
            }}
            className="text-xs font-medium text-[var(--accent)]"
          >
            {copy.sidebar.reset}
          </button>
        </div>
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => onSelectSource(null)}
            className={`filter-tile ${selectedSource === null ? "is-selected" : ""}`}
          >
            <span className="text-sm font-medium">{copy.sidebar.allSources}</span>
            <span className="text-xs text-[var(--text-muted)]">
              {numberFormatter.format(totalIndexedEntries)} {copy.sidebar.indexed}
            </span>
          </button>
          {sources.map((source) => (
            <button
              key={source.source_id}
              type="button"
              onClick={() => {
                onSelectSource(source.source_id);
                onSelectProject(null);
              }}
              className={`filter-tile ${selectedSource === source.source_id ? "is-selected" : ""}`}
            >
              <div className="flex items-center gap-3">
                <span className={`h-2 w-2 rounded-full ${statusTone(source.status)}`} />
                <div className="min-w-0 text-left">
                  <div className="truncate text-sm font-medium text-slate-200">
                    {source.name}
                  </div>
                  <div className="truncate text-xs text-[var(--text-muted)]">
                    {statusLabel(source.last_run_status ?? source.status, copy.statusLabels)}
                    {lagLabel(source.lag_seconds, language)
                      ? ` · ${lagLabel(source.lag_seconds, language)}`
                      : ""}
                  </div>
                </div>
              </div>
              <div className="text-right text-xs text-[var(--text-muted)]">
                <div>{numberFormatter.format(source.entry_count ?? 0)}</div>
                {source.error_message && (
                  <div className="max-w-[8rem] truncate text-rose-500">
                    {source.error_message}
                  </div>
                )}
              </div>
            </button>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <div className="section-kicker">{copy.sidebar.projectSection}</div>
        {selectedSource && (
          <p className="text-xs text-[var(--text-muted)]">{copy.sidebar.scopedProjectsHint}</p>
        )}
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => onSelectProject(null)}
            className={`filter-tile ${selectedProject === null ? "is-selected" : ""}`}
          >
            <span className="text-sm font-medium">{copy.sidebar.allProjects}</span>
            <span className="text-xs text-[var(--text-muted)]">
              {numberFormatter.format(selectedSource ? visibleProjects.length : totalProjects)}{" "}
              {copy.sidebar.scopes}
            </span>
          </button>
          {visibleProjects.map(({ sourceName, project }) => (
            <button
              key={`${sourceName}:${project}`}
              type="button"
              onClick={() => onSelectProject(project)}
              className={`filter-tile ${selectedProject === project ? "is-selected" : ""}`}
            >
              <div className="min-w-0 text-left">
                <div className="truncate text-sm font-medium text-slate-200">
                  {project.split("/").pop()}
                </div>
                <div className="truncate text-xs text-[var(--text-muted)]">{sourceName}</div>
              </div>
              <span className="max-w-[10rem] truncate text-xs text-[var(--text-muted)]">
                {project}
              </span>
            </button>
          ))}
          {visibleProjects.length === 0 && (
            <div className="rounded-lg border border-dashed border-[var(--border)] bg-[var(--bg-elevated)] px-4 py-4 text-sm text-[var(--text-muted)]">
              {copy.sidebar.emptyProjects}
            </div>
          )}
        </div>
      </section>

      <MessageTemplateSettings
        templates={promptTemplates}
        copy={copy.messageTemplates}
        onChange={onPromptTemplatesChange}
      />

      <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] p-4 text-sm text-[var(--text-muted)]">
        {copy.sidebar.footer}
      </div>
    </aside>
  );
}
