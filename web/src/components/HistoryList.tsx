import { Fragment } from "react";

import type { EntrySummary, Mode, SearchHit } from "../types";
import type { UiCopy } from "../i18n";
import { splitHighlightedSnippet } from "../searchSnippet";
import SourceBadge from "./SourceBadge";

type EntryListItem = EntrySummary | SearchHit;

interface HistoryListProps {
  mode: Mode;
  entries: EntryListItem[];
  onSelect: (entry: EntryListItem) => void;
  selectedId?: string | null;
  loading?: boolean;
  loadingMore?: boolean;
  locale: string;
  copy: Pick<UiCopy, "history" | "entryTypes">;
  emptyMessage: string;
  hasMore?: boolean;
  onLoadMore?: () => void;
}

function formatDate(timestamp: string, locale: string): string {
  const value = new Date(timestamp);
  return value.toLocaleString(locale, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function Snippet({ snippet }: { snippet?: string }) {
  if (!snippet) return null;

  const parts = splitHighlightedSnippet(snippet);
  return (
    <p className="text-sm leading-6 text-[var(--text-secondary)]">
      {parts.map((part, index) =>
        part.highlighted ? (
          <mark key={index}>{part.text}</mark>
        ) : (
          <Fragment key={index}>{part.text}</Fragment>
        )
      )}
    </p>
  );
}

export default function HistoryList({
  mode,
  entries,
  onSelect,
  selectedId,
  loading,
  loadingMore,
  locale,
  copy,
  emptyMessage,
  hasMore,
  onLoadMore,
}: HistoryListProps) {
  if (loading) {
    return (
      <div className="app-card flex min-h-[20rem] items-center justify-center p-6 text-[var(--text-muted)]">
        {copy.history.loading}
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="app-card flex min-h-[20rem] items-center justify-center p-6 text-center text-[var(--text-muted)]">
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {entries.map((entry) => (
        <button
          key={entry.entry_id}
          type="button"
          onClick={() => onSelect(entry)}
          className={`list-card ${selectedId === entry.entry_id ? "is-selected" : ""}`}
        >
          <div className="flex flex-wrap items-center gap-2">
            <SourceBadge source={entry.source} />
            <span className="rounded-md bg-slate-800 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">
              {copy.entryTypes[entry.type]}
            </span>
            {mode === "search" && entry.score != null && (
              <span className="ml-auto rounded-md bg-[var(--accent-soft)] px-2 py-0.5 text-[10px] font-semibold text-[var(--accent)]">
                {(entry.score ?? 0).toFixed(2)}
              </span>
            )}
            <span className="ml-auto text-xs text-[var(--text-muted)]">
              {formatDate(entry.timestamp, locale)}
            </span>
          </div>

          <div className="mt-2.5 text-left">
            <h3 className="text-[15px] font-semibold text-slate-100">{entry.title}</h3>
            {entry.project && (
              <p className="mt-0.5 text-xs text-[var(--text-muted)]">{entry.project}</p>
            )}
          </div>

          <div className="mt-2 text-left">
            <Snippet snippet={entry.snippet} />
          </div>

          {(entry.tags?.length ?? 0) > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {entry.tags.slice(0, 4).map((tag) => (
                <span
                  key={tag}
                  className="rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] px-2 py-0.5 text-[10px] font-medium text-[var(--text-muted)]"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
        </button>
      ))}

      {hasMore && onLoadMore && (
        <button
          type="button"
          onClick={onLoadMore}
          className="app-card flex w-full items-center justify-center gap-2 p-3 text-sm font-semibold text-[var(--accent)] transition hover:bg-[var(--bg-elevated)]"
        >
          {loadingMore ? copy.history.loadingMore : copy.history.loadMore}
        </button>
      )}
    </div>
  );
}
