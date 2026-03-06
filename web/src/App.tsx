import { startTransition, useEffect, useState } from "react";
import type {
  DistillArtifact,
  EntryDetail,
  EntrySummary,
  EntryType,
  Mode,
  SearchHit,
  SourceInfo,
} from "./types";
import {
  getEntries,
  getEntry,
  getProjects,
  getSources,
  runDistill,
  search as searchEntries,
} from "./api/client";
import ConversationView from "./components/ConversationView";
import DistillPanel from "./components/DistillPanel";
import HistoryList from "./components/HistoryList";
import SearchBar from "./components/SearchBar";
import Sidebar from "./components/Sidebar";
import {
  detectInitialLanguage,
  getCopy,
  getLocale,
  LANGUAGE_STORAGE_KEY,
  type Language,
} from "./i18n";
import {
  loadPromptInjectionTemplates,
  PROMPT_TEMPLATE_STORAGE_KEY,
  type PromptInjectionTemplate,
} from "./messageDisplay";
import {
  applyModeChange,
  applyProjectFilter,
  applySourceFilter,
  shouldFetchEntryDetail,
} from "./viewState";

const PAGE_SIZE = 24;

export default function App() {
  const [language, setLanguage] = useState<Language>(() => detectInitialLanguage());
  const [promptTemplates, setPromptTemplates] = useState<PromptInjectionTemplate[]>(() =>
    loadPromptInjectionTemplates()
  );
  const [mode, setMode] = useState<Mode>("explore");
  const [sources, setSources] = useState<SourceInfo[]>([]);
  const [projects, setProjects] = useState<Record<string, string[]>>({});
  const [selectedSource, setSelectedSource] = useState<string | null>(null);
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [selectedType, setSelectedType] = useState<EntryType | null>(null);

  const [exploreEntries, setExploreEntries] = useState<EntrySummary[]>([]);
  const [exploreCursor, setExploreCursor] = useState<string | null>(null);
  const [exploreLoading, setExploreLoading] = useState(true);
  const [exploreLoadingMore, setExploreLoadingMore] = useState(false);
  const [exploreError, setExploreError] = useState<string | null>(null);

  const [searchInput, setSearchInput] = useState("");
  const [submittedSearch, setSubmittedSearch] = useState("");
  const [searchResults, setSearchResults] = useState<SearchHit[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const [distillArtifact, setDistillArtifact] = useState<DistillArtifact | null>(null);
  const [distillLoading, setDistillLoading] = useState(false);
  const [distillError, setDistillError] = useState<string | null>(null);
  const [distillRefreshKey, setDistillRefreshKey] = useState(0);

  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);
  const [entryCache, setEntryCache] = useState<Record<string, EntryDetail>>({});
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const copy = getCopy(language);
  const locale = getLocale(language);

  function syncViewState(next: {
    mode: Mode;
    selectedSource: string | null;
    selectedProject: string | null;
    selectedEntryId: string | null;
  }) {
    setMode(next.mode);
    setSelectedSource(next.selectedSource);
    setSelectedProject(next.selectedProject);
    setSelectedEntryId(next.selectedEntryId);
  }

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.setAttribute("data-mode", mode);
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  }, [language, locale, mode]);

  useEffect(() => {
    window.localStorage.setItem(
      PROMPT_TEMPLATE_STORAGE_KEY,
      JSON.stringify(promptTemplates)
    );
  }, [promptTemplates]);

  useEffect(() => {
    async function bootstrap() {
      try {
        const [sourceData, projectData] = await Promise.all([getSources(), getProjects()]);
        setSources(sourceData);
        setProjects(projectData);
      } catch (error) {
        setExploreError(error instanceof Error ? error.message : "Failed to load source metadata");
      }
    }

    void bootstrap();
  }, []);

  useEffect(() => {
    if (mode !== "explore") return;

    async function loadFirstPage() {
      setExploreLoading(true);
      setExploreError(null);
      setSelectedEntryId(null);
      try {
        const page = await getEntries({
          limit: PAGE_SIZE,
          source: selectedSource ?? undefined,
          project: selectedProject ?? undefined,
        });
        setExploreEntries(page.entries);
        setExploreCursor(page.nextCursor);
      } catch (error) {
        setExploreError(error instanceof Error ? error.message : "Failed to load entries");
      } finally {
        setExploreLoading(false);
      }
    }

    void loadFirstPage();
  }, [mode, selectedSource, selectedProject]);

  useEffect(() => {
    if (mode !== "search") return;
    if (!submittedSearch.trim()) {
      setSearchResults([]);
      setSearchError(null);
      return;
    }

    async function loadSearchResults() {
      setSearchLoading(true);
      setSearchError(null);
      setSelectedEntryId(null);
      try {
        const result = await searchEntries({
          q: submittedSearch,
          sources: selectedSource ?? undefined,
          types: selectedType ?? undefined,
          project: selectedProject ?? undefined,
          limit: 50,
        });
        setSearchResults(result.entries);
      } catch (error) {
        setSearchError(error instanceof Error ? error.message : "Failed to search history");
      } finally {
        setSearchLoading(false);
      }
    }

    void loadSearchResults();
  }, [mode, submittedSearch, selectedProject, selectedSource, selectedType]);

  useEffect(() => {
    if (mode !== "distill") return;

    async function loadDistillArtifact() {
      setDistillLoading(true);
      setDistillError(null);
      try {
        const artifact = await runDistill({
          source: selectedSource ?? undefined,
          project: selectedProject ?? undefined,
          limit: 12,
        });
        setDistillArtifact(artifact);
      } catch (error) {
        setDistillArtifact(null);
        setDistillError(error instanceof Error ? error.message : "Failed to build distill artifact");
      } finally {
        setDistillLoading(false);
      }
    }

    void loadDistillArtifact();
  }, [distillRefreshKey, mode, selectedProject, selectedSource]);

  useEffect(() => {
    if (!selectedEntryId) {
      setDetailError(null);
      return;
    }

    const entryId = selectedEntryId;
    if (!shouldFetchEntryDetail(entryId, entryCache)) {
      return;
    }

    async function loadEntryDetail() {
      setDetailLoading(true);
      setDetailError(null);
      try {
        const detail = await getEntry(entryId);
        setEntryCache((current) => ({ ...current, [entryId]: detail }));
      } catch (error) {
        setDetailError(error instanceof Error ? error.message : "Failed to load entry detail");
      } finally {
        setDetailLoading(false);
      }
    }

    void loadEntryDetail();
  }, [entryCache, selectedEntryId]);

  const selectedEntry = selectedEntryId ? entryCache[selectedEntryId] ?? null : null;

  async function loadMoreExploreEntries() {
    if (!exploreCursor) return;

    setExploreLoadingMore(true);
    try {
      const page = await getEntries({
        limit: PAGE_SIZE,
        cursor: exploreCursor,
        source: selectedSource ?? undefined,
        project: selectedProject ?? undefined,
      });
      setExploreEntries((current) => [...current, ...page.entries]);
      setExploreCursor(page.nextCursor);
    } catch (error) {
      setExploreError(error instanceof Error ? error.message : "Failed to load more entries");
    } finally {
      setExploreLoadingMore(false);
    }
  }

  const currentEntries = mode === "search" ? searchResults : exploreEntries;
  const currentLoading = mode === "search" ? searchLoading : exploreLoading;
  const currentError = mode === "search" ? searchError : exploreError;
  const activeFilterCount = [
    selectedSource,
    selectedProject,
    selectedType,
    submittedSearch.trim(),
  ].filter(Boolean).length;
  const totalIndexedEntries = sources.reduce(
    (total, source) => total + (source.entry_count ?? 0),
    0
  );
  const totalProjects = Object.values(projects).reduce(
    (count, sourceProjects) => count + sourceProjects.length,
    0
  );
  const currentItemCount =
    mode === "distill" ? (distillArtifact?.provenance_entry_ids.length ?? 0) : currentEntries.length;
  const numberFormatter = new Intl.NumberFormat(locale);
  const hasActiveFilters = activeFilterCount > 0;
  const showMobileDetail = Boolean(selectedEntryId);

  function resetAllFilters() {
    setSelectedSource(null);
    setSelectedProject(null);
    setSelectedType(null);
    setSearchInput("");
    setSubmittedSearch("");
    setSelectedEntryId(null);
  }

  return (
    <div className="app-shell" data-mode={mode}>
      {showMobileDetail && (
        <div className="fixed inset-0 z-50 bg-black/70 p-3 backdrop-blur-sm lg:hidden">
          <div className="mx-auto flex h-full max-w-3xl flex-col">
            <ConversationView
              entry={selectedEntry}
              loading={detailLoading}
              error={detailError}
              locale={locale}
              copy={copy.conversation}
              promptTemplates={promptTemplates}
              onClose={() => setSelectedEntryId(null)}
            />
          </div>
        </div>
      )}

      <div className="mx-auto flex min-h-screen w-full max-w-[1820px] flex-col gap-4 px-3 py-4 lg:grid lg:grid-cols-[300px_minmax(0,1.1fr)_minmax(320px,0.95fr)] lg:gap-5 lg:px-5 2xl:grid-cols-[320px_minmax(0,1.12fr)_minmax(360px,0.98fr)]">
        <Sidebar
          mode={mode}
          language={language}
          locale={locale}
          copy={copy}
          totalProjects={totalProjects}
          activeFilterCount={activeFilterCount}
          promptTemplates={promptTemplates}
          onLanguageChange={setLanguage}
          onPromptTemplatesChange={setPromptTemplates}
          onModeChange={(nextMode) => {
            syncViewState(
              applyModeChange(
                {
                  mode,
                  selectedSource,
                  selectedProject,
                  selectedEntryId,
                },
                nextMode
              )
            );
          }}
          sources={sources}
          selectedSource={selectedSource}
          onSelectSource={(sourceId) => {
            syncViewState(
              applySourceFilter(
                {
                  mode,
                  selectedSource,
                  selectedProject,
                  selectedEntryId,
                },
                sourceId
              )
            );
          }}
          projects={projects}
          selectedProject={selectedProject}
          onSelectProject={(project) => {
            syncViewState(
              applyProjectFilter(
                {
                  mode,
                  selectedSource,
                  selectedProject,
                  selectedEntryId,
                },
                project
              )
            );
          }}
        />

        <main className="flex min-h-[calc(100vh-2rem)] flex-col gap-4">
          <section className="app-card p-5 md:p-6">
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
                <div className="max-w-3xl">
                  <div className="section-kicker">{copy.modeLabels[mode]}</div>
                  <h2 className="font-display mt-2 text-2xl font-bold text-slate-100 md:text-3xl">
                    {copy.modeTitles[mode]}
                  </h2>
                  <p className="mt-3 text-sm leading-7 text-[var(--text-secondary)] md:text-[15px]">
                    {copy.modeDescriptions[mode]}
                  </p>
                </div>
                <div className="grid gap-3 sm:grid-cols-3 xl:min-w-[430px]">
                  {[
                    {
                      label: copy.main.visibleItems,
                      value: numberFormatter.format(currentItemCount),
                    },
                    {
                      label: copy.main.indexedEntries,
                      value: numberFormatter.format(totalIndexedEntries),
                    },
                    {
                      label: copy.main.activeFilters,
                      value: numberFormatter.format(activeFilterCount),
                    },
                  ].map((stat) => (
                    <div key={stat.label} className="stat-card">
                      <div className="stat-label">{stat.label}</div>
                      <div className="stat-value">{stat.value}</div>
                    </div>
                  ))}
                </div>
              </div>

              {mode === "search" && (
                <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] p-4">
                  <SearchBar
                    value={searchInput}
                    loading={searchLoading}
                    ariaLabel={copy.search.ariaLabel}
                    placeholder={copy.search.placeholder}
                    submitLabel={copy.search.submit}
                    submittingLabel={copy.search.submitting}
                    clearLabel={copy.search.clear}
                    onChange={setSearchInput}
                    onSubmit={() => {
                      startTransition(() => {
                        setSubmittedSearch(searchInput.trim());
                        setSelectedEntryId(null);
                      });
                    }}
                    onClear={() => {
                      setSearchInput("");
                      setSubmittedSearch("");
                      setSelectedEntryId(null);
                    }}
                  />

                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    {[
                      { label: copy.entryTypes.all, value: null },
                      {
                        label: copy.entryTypes.conversation,
                        value: "conversation" as EntryType,
                      },
                      { label: copy.entryTypes.visit, value: "visit" as EntryType },
                    ].map((option) => (
                      <button
                        key={option.label}
                        type="button"
                        onClick={() => setSelectedType(option.value)}
                        className={`rounded-md border px-3 py-2 text-xs font-semibold uppercase tracking-[0.18em] transition ${
                          selectedType === option.value
                            ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]"
                            : "border-[var(--border)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:border-[var(--border-hover)]"
                        }`}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                  <p className="mt-3 text-xs text-[var(--text-muted)]">{copy.search.helper}</p>
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--text-muted)]">
                {selectedSource && (
                  <span className="pill-chip">
                    {copy.filters.source}:{" "}
                    {sources.find((source) => source.source_id === selectedSource)?.name ?? selectedSource}
                  </span>
                )}
                {selectedProject && (
                  <span className="pill-chip">
                    {copy.filters.project}: {selectedProject}
                  </span>
                )}
                {mode === "search" && submittedSearch && (
                  <span className="pill-chip">
                    {copy.filters.query}: {submittedSearch}
                  </span>
                )}
                {mode === "search" && selectedType && (
                  <span className="pill-chip">
                    {copy.filters.type}: {copy.entryTypes[selectedType]}
                  </span>
                )}
                {!hasActiveFilters && (
                  <span className="text-xs text-[var(--text-muted)]">{copy.filters.noFilters}</span>
                )}
                {hasActiveFilters && (
                  <button
                    type="button"
                    onClick={resetAllFilters}
                    className="rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--accent)] transition hover:border-[var(--accent)]"
                  >
                    {copy.filters.clearAll}
                  </button>
                )}
              </div>
            </div>
          </section>

          {mode === "distill" ? (
            <DistillPanel
              artifact={distillArtifact}
              loading={distillLoading}
              error={distillError}
              copy={copy.distill}
              onRefresh={() => setDistillRefreshKey((value) => value + 1)}
              onSelectEntry={(entryId) => setSelectedEntryId(entryId)}
            />
          ) : (
            <>
              {currentError && <div className="app-card p-4 text-sm text-rose-600">{currentError}</div>}
              <HistoryList
                mode={mode}
                entries={currentEntries}
                onSelect={(entry) => setSelectedEntryId(entry.entry_id)}
                selectedId={selectedEntryId}
                loading={currentLoading}
                loadingMore={exploreLoadingMore}
                locale={locale}
                copy={{
                  history: copy.history,
                  entryTypes: copy.entryTypes,
                }}
                emptyMessage={
                  mode === "search" ? copy.history.emptySearch : copy.history.emptyExplore
                }
                hasMore={mode === "explore" && Boolean(exploreCursor)}
                onLoadMore={mode === "explore" ? loadMoreExploreEntries : undefined}
              />
            </>
          )}
        </main>

        <div className="hidden lg:block lg:sticky lg:top-4 lg:h-[calc(100vh-2rem)]">
          <ConversationView
            entry={selectedEntry}
            loading={detailLoading}
            error={detailError}
            locale={locale}
            copy={copy.conversation}
            promptTemplates={promptTemplates}
            onClose={() => setSelectedEntryId(null)}
          />
        </div>
      </div>
    </div>
  );
}
