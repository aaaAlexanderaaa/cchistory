import { useState, useEffect, useCallback } from "react";
import type { HistoryEntry, SourceInfo } from "./types";
import {
  getSources,
  getHistory,
  getProjects,
  search as apiSearch,
} from "./api/client";
import Sidebar from "./components/Sidebar";
import SearchBar from "./components/SearchBar";
import HistoryList from "./components/HistoryList";
import ConversationView from "./components/ConversationView";

export default function App() {
  const [sources, setSources] = useState<SourceInfo[]>([]);
  const [projects, setProjects] = useState<Record<string, string[]>>({});
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [selectedEntry, setSelectedEntry] = useState<HistoryEntry | null>(null);
  const [selectedSource, setSelectedSource] = useState<string | null>(null);
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getSources()
      .then(setSources)
      .catch((e) => setError(e.message));
    getProjects()
      .then(setProjects)
      .catch(() => {});
  }, []);

  const loadEntries = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (searchQuery) {
        const result = await apiSearch({
          q: searchQuery,
          sources: selectedSource || undefined,
          project: selectedProject || undefined,
        });
        setEntries(result.entries);
      } else {
        const data = await getHistory({
          source: selectedSource || undefined,
          project: selectedProject || undefined,
          limit: 100,
        });
        setEntries(data);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load entries");
    } finally {
      setLoading(false);
    }
  }, [selectedSource, selectedProject, searchQuery]);

  useEffect(() => {
    loadEntries();
  }, [loadEntries]);

  const handleSearch = useCallback((query: string) => {
    setSearchQuery(query);
    setSelectedEntry(null);
  }, []);

  return (
    <div className="flex h-screen bg-gray-950 text-gray-100">
      <Sidebar
        sources={sources}
        selectedSource={selectedSource}
        onSelectSource={(s) => {
          setSelectedSource(s);
          setSelectedEntry(null);
        }}
        projects={projects}
        selectedProject={selectedProject}
        onSelectProject={(p) => {
          setSelectedProject(p);
          setSelectedEntry(null);
        }}
      />

      <div className="flex-1 flex flex-col min-w-0">
        <header className="px-4 py-3 border-b border-gray-800 bg-gray-900/30">
          <SearchBar onSearch={handleSearch} loading={loading} />
          {searchQuery && (
            <div className="flex items-center gap-2 mt-2">
              <span className="text-xs text-gray-500">
                Results for &quot;{searchQuery}&quot;
              </span>
              <button
                onClick={() => setSearchQuery("")}
                className="text-xs text-violet-400 hover:underline"
              >
                Clear
              </button>
            </div>
          )}
        </header>

        {error && (
          <div className="px-4 py-2 bg-red-900/20 border-b border-red-800/30 text-red-400 text-sm">
            {error}
          </div>
        )}

        <div className="flex-1 flex overflow-hidden">
          <div
            className={`${
              selectedEntry ? "w-1/3 border-r border-gray-800" : "w-full"
            } overflow-y-auto`}
          >
            <HistoryList
              entries={entries}
              onSelect={setSelectedEntry}
              selectedId={selectedEntry?.id}
              loading={loading}
            />
          </div>

          {selectedEntry && (
            <div className="flex-1 overflow-hidden">
              <ConversationView
                entry={selectedEntry}
                onClose={() => setSelectedEntry(null)}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
