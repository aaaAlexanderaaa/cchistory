import type { HistoryEntry } from "../types";
import SourceBadge from "./SourceBadge";

interface HistoryListProps {
  entries: HistoryEntry[];
  onSelect: (entry: HistoryEntry) => void;
  selectedId?: string;
  loading?: boolean;
}

function formatDate(ts: string): string {
  const d = new Date(ts);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const hours = diff / (1000 * 60 * 60);

  if (hours < 1) return `${Math.floor(diff / 60000)}m ago`;
  if (hours < 24) return `${Math.floor(hours)}h ago`;
  if (hours < 48) return "Yesterday";
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: d.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
  });
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

export default function HistoryList({
  entries,
  onSelect,
  selectedId,
  loading,
}: HistoryListProps) {
  if (loading) {
    return (
      <div className="flex items-center justify-center h-40 text-gray-500">
        Loading...
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="flex items-center justify-center h-40 text-gray-600">
        No history entries found
      </div>
    );
  }

  return (
    <div className="divide-y divide-gray-800/50">
      {entries.map((entry) => (
        <button
          key={entry.id}
          onClick={() => onSelect(entry)}
          className={`w-full text-left px-4 py-3 transition-colors hover:bg-gray-800/50 ${
            selectedId === entry.id ? "bg-gray-800/70 border-l-2 border-violet-500" : ""
          }`}
        >
          <div className="flex items-center gap-2 mb-1">
            <SourceBadge source={entry.source} />
            {entry.type === "conversation" && (
              <span className="text-xs text-gray-600">
                {entry.messages?.length || 0} msgs
              </span>
            )}
            <span className="text-xs text-gray-600 ml-auto">
              {formatDate(entry.timestamp)}
            </span>
          </div>
          <div className="text-sm text-gray-200 truncate">{entry.title}</div>
          {entry.project && (
            <div className="text-xs text-gray-500 mt-0.5 truncate">
              {entry.project}
            </div>
          )}
          {entry.url && (
            <div className="text-xs text-gray-600 mt-0.5 truncate">
              {entry.url}
            </div>
          )}
          {entry.duration_seconds != null && entry.duration_seconds > 0 && (
            <div className="text-xs text-gray-600 mt-0.5">
              Duration: {formatDuration(entry.duration_seconds)}
            </div>
          )}
        </button>
      ))}
    </div>
  );
}
