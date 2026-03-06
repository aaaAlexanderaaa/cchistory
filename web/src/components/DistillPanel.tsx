import type { DistillArtifact } from "../types";
import type { UiCopy } from "../i18n";

interface DistillPanelProps {
  artifact: DistillArtifact | null;
  loading?: boolean;
  error?: string | null;
  copy: UiCopy["distill"];
  onRefresh: () => void;
  onSelectEntry: (entryId: string) => void;
}

function ArtifactSection({
  title,
  items,
  emptyLabel,
}: {
  title: string;
  items: string[];
  emptyLabel: string;
}) {
  return (
    <section className="app-card p-5">
      <div className="section-kicker">{title}</div>
      {items.length === 0 ? (
        <p className="mt-3 text-sm text-[var(--text-muted)]">{emptyLabel}</p>
      ) : (
        <ul className="mt-4 space-y-2">
          {items.map((item) => (
            <li
              key={item}
              className="rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] px-4 py-3 text-sm leading-6 text-slate-300"
            >
              {item}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default function DistillPanel({
  artifact,
  loading,
  error,
  copy,
  onRefresh,
  onSelectEntry,
}: DistillPanelProps) {
  if (loading) {
    return (
      <div className="app-card flex min-h-[20rem] items-center justify-center p-6 text-[var(--text-muted)]">
        {copy.loading}
      </div>
    );
  }

  if (error) {
    return (
      <div className="app-card space-y-3 p-6">
        <p className="text-sm text-rose-500">{error}</p>
        <button
          type="button"
          onClick={onRefresh}
          className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-[var(--bg-deep)]"
        >
          {copy.retry}
        </button>
      </div>
    );
  }

  if (!artifact) {
    return (
      <div className="app-card flex min-h-[20rem] flex-col items-center justify-center gap-4 p-6 text-center text-[var(--text-muted)]">
        <p>{copy.empty}</p>
        <button
          type="button"
          onClick={onRefresh}
          className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-[var(--bg-deep)]"
        >
          {copy.generate}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <section className="app-card p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="section-kicker">{copy.artifact}</div>
            <h2 className="font-display mt-2 text-2xl font-bold text-slate-100">
              {artifact.title}
            </h2>
            <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-300">
              {artifact.summary}
            </p>
          </div>
          <button
            type="button"
            onClick={onRefresh}
            className="rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] px-4 py-2 text-sm font-semibold text-[var(--accent)] transition hover:border-[var(--accent)]"
          >
            {copy.refresh}
          </button>
        </div>

        {artifact.tags.length > 0 && (
          <div className="mt-5 flex flex-wrap gap-1.5">
            {artifact.tags.map((tag) => (
              <span
                key={tag}
                className="rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] px-2 py-0.5 text-[10px] font-medium text-[var(--text-muted)]"
              >
                {tag}
              </span>
            ))}
          </div>
        )}
      </section>

      <div className="grid gap-4 xl:grid-cols-2">
        <ArtifactSection
          title={copy.patterns}
          items={artifact.patterns}
          emptyLabel={copy.nothingExtracted}
        />
        <ArtifactSection
          title={copy.decisions}
          items={artifact.decisions}
          emptyLabel={copy.nothingExtracted}
        />
        <ArtifactSection
          title={copy.openQuestions}
          items={artifact.open_questions}
          emptyLabel={copy.nothingExtracted}
        />

        <section className="app-card p-5">
          <div className="section-kicker">{copy.provenance}</div>
          <div className="mt-4 space-y-2">
            {artifact.provenance_entry_ids.map((entryId) => (
              <button
                key={entryId}
                type="button"
                onClick={() => onSelectEntry(entryId)}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] px-4 py-3 text-left text-sm font-medium text-slate-300 transition hover:border-[var(--accent)] hover:text-[var(--accent)]"
              >
                {entryId}
              </button>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
