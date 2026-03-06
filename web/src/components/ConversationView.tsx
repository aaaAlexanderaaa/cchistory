import { useEffect, useMemo, useState } from "react";

import type { UiCopy } from "../i18n";
import {
  buildCollapsedPreview,
  matchPromptInjectionTemplate,
  messageKindLabel,
  metadataString,
  shouldCollapseMessageByDefault,
  terminationReasonLabel,
  type PromptInjectionTemplate,
} from "../messageDisplay";
import type { EntryDetail, Message } from "../types";
import SourceBadge from "./SourceBadge";

interface ConversationViewProps {
  entry: EntryDetail | null;
  loading?: boolean;
  error?: string | null;
  locale: string;
  copy: UiCopy["conversation"];
  promptTemplates: PromptInjectionTemplate[];
  onClose: () => void;
}

function RolePill({
  role,
  labels,
}: {
  role: string;
  labels: UiCopy["conversation"]["roleLabels"];
}) {
  const tones: Record<string, string> = {
    user: "border-sky-500/30 bg-sky-500/10 text-sky-400",
    assistant: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
    tool: "border-amber-500/30 bg-amber-500/10 text-amber-400",
    system: "border-slate-500/30 bg-slate-500/10 text-slate-400",
  };
  return (
    <span
      className={`inline-flex rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] ${
        tones[role] || tones.system
      }`}
    >
      {labels[role as keyof typeof labels] ?? role}
    </span>
  );
}

function metadataCount(metadata: Record<string, unknown> | undefined, key: string): number | null {
  const value = metadata?.[key];
  return typeof value === "number" ? value : null;
}

function MessageCard({
  message,
  locale,
  copy,
  promptTemplates,
  collapsed,
  onToggle,
}: {
  message: Message;
  locale: string;
  copy: UiCopy["conversation"];
  promptTemplates: PromptInjectionTemplate[];
  collapsed: boolean;
  onToggle: () => void;
}) {
  const blockType =
    typeof message.metadata?.block_type === "string" ? message.metadata.block_type : null;
  const toolStage =
    blockType === "tool_use" ? "call" : blockType === "tool_result" ? "result" : null;
  const tones: Record<string, string> = {
    user: "border-sky-500/15 bg-sky-950/30",
    assistant: "border-emerald-500/15 bg-emerald-950/30",
    tool: "border-amber-500/15 bg-amber-950/30",
    system: "border-slate-600/15 bg-slate-900/40",
  };
  const matchedTemplate = matchPromptInjectionTemplate(message, promptTemplates);
  const kindLabel = messageKindLabel(message, copy);
  const stopReason = terminationReasonLabel(metadataString(message, "stop_reason"), copy);
  const explicitReason = terminationReasonLabel(
    metadataString(message, "termination_reason"),
    copy
  );

  return (
    <div className={`message-card ${tones[message.role] || tones.system}`}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <RolePill role={message.role} labels={copy.roleLabels} />
        {message.tool_name && (
          <span className="rounded-md bg-[var(--bg-elevated)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">
            {message.tool_name}
          </span>
        )}
        {toolStage && (
          <span className="rounded-md bg-slate-800 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">
            {copy.toolStages[toolStage]}
          </span>
        )}
        {kindLabel && (
          <span className="rounded-md bg-[var(--bg-elevated)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">
            {kindLabel}
          </span>
        )}
        {matchedTemplate && (
          <span className="rounded-md bg-[var(--bg-elevated)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">
            {copy.promptTemplate}: {matchedTemplate.name}
          </span>
        )}
        {stopReason && (
          <span className="rounded-md bg-[var(--accent-soft)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--accent)]">
            {copy.termination}: {stopReason}
          </span>
        )}
        {!stopReason && explicitReason && (
          <span className="rounded-md bg-[var(--accent-soft)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--accent)]">
            {copy.termination}: {explicitReason}
          </span>
        )}
        {message.timestamp && (
          <span className="ml-auto text-xs text-[var(--text-muted)]">
            {new Date(message.timestamp).toLocaleString(locale, {
              dateStyle: "medium",
              timeStyle: "short",
            })}
          </span>
        )}
        <button
          type="button"
          onClick={onToggle}
          className="rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-1 text-xs font-medium text-[var(--text-secondary)] transition hover:border-[var(--border-hover)] hover:text-slate-200"
        >
          {collapsed ? copy.expand : copy.collapse}
        </button>
      </div>

      {collapsed ? (
        <p className="message-preview text-sm text-[var(--text-secondary)]">
          {buildCollapsedPreview(message, promptTemplates) || copy.emptyMessage}
        </p>
      ) : (
        <div
          className={`overflow-x-auto whitespace-pre-wrap text-sm text-slate-300 ${
            message.role === "tool" ? "font-mono leading-6" : "leading-7"
          }`}
        >
          {message.content || copy.emptyMessage}
        </div>
      )}
    </div>
  );
}

export default function ConversationView({
  entry,
  loading,
  error,
  locale,
  copy,
  promptTemplates,
  onClose,
}: ConversationViewProps) {
  const [collapsedMessages, setCollapsedMessages] = useState<Record<string, boolean>>({});

  const collapseDefaults = useMemo(() => {
    if (!entry?.messages) return {};
    return Object.fromEntries(
      entry.messages.map((message, index) => [
        `${entry.entry_id}:${index}`,
        shouldCollapseMessageByDefault(message, promptTemplates),
      ])
    );
  }, [entry, promptTemplates]);

  useEffect(() => {
    setCollapsedMessages(collapseDefaults);
  }, [collapseDefaults]);

  if (loading) {
    return (
      <div className="app-card flex h-full min-h-[20rem] items-center justify-center p-6 text-[var(--text-muted)]">
        {copy.loading}
      </div>
    );
  }

  if (error) {
    return <div className="app-card h-full min-h-[20rem] p-6 text-sm text-rose-500">{error}</div>;
  }

  if (!entry) {
    return (
      <div className="app-card flex h-full min-h-[20rem] items-center justify-center p-6 text-center text-[var(--text-muted)]">
        {copy.empty}
      </div>
    );
  }

  const terminationReason = terminationReasonLabel(
    typeof entry.metadata?.termination_reason === "string"
      ? entry.metadata.termination_reason
      : null,
    copy
  );
  const promptInjectionCount = metadataCount(entry.metadata, "prompt_injection_count");
  const compactionCount = metadataCount(entry.metadata, "compaction_count");

  return (
    <div className="app-card flex h-full flex-col gap-4 overflow-hidden p-5">
      <div className="sticky top-0 z-10 -mx-5 border-b border-[var(--border)] bg-[var(--bg-surface)] px-5 pb-4 backdrop-blur-sm">
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-1.5 text-sm font-medium text-[var(--text-secondary)] transition hover:border-[var(--border-hover)] hover:text-slate-200"
        >
          {copy.back}
        </button>
        <div className="mt-4 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <SourceBadge source={entry.source} />
            <h2 className="text-lg font-semibold text-slate-100">{entry.title}</h2>
          </div>
          <div className="mt-2 flex flex-wrap gap-3 text-xs text-[var(--text-muted)]">
            <span>
              {new Date(entry.timestamp).toLocaleString(locale, {
                dateStyle: "medium",
                timeStyle: "short",
              })}
            </span>
            {entry.project && <span>{entry.project}</span>}
            {entry.duration_seconds != null && <span>{entry.duration_seconds}s</span>}
            {terminationReason && (
              <span className="pill-chip">
                {copy.termination}: {terminationReason}
              </span>
            )}
            {promptInjectionCount != null && promptInjectionCount > 0 && (
              <span className="pill-chip">
                {copy.messageKinds.prompt_injection}: {promptInjectionCount}
              </span>
            )}
            {compactionCount != null && compactionCount > 0 && (
              <span className="pill-chip">
                {copy.messageKinds.compact_boundary}: {compactionCount}
              </span>
            )}
          </div>
        </div>
      </div>

      {entry.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {entry.tags.map((tag) => (
            <span
              key={tag}
              className="rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] px-2 py-0.5 text-[10px] font-medium text-[var(--text-muted)]"
            >
              {tag}
            </span>
          ))}
        </div>
      )}

      {entry.messages && entry.messages.length > 0 ? (
        <div className="panel-scroll space-y-3 pr-1">
          {entry.messages.map((message, index) => {
            const key = `${entry.entry_id}:${index}`;
            return (
              <MessageCard
                key={key}
                message={message}
                locale={locale}
                copy={copy}
                promptTemplates={promptTemplates}
                collapsed={collapsedMessages[key] ?? false}
                onToggle={() =>
                  setCollapsedMessages((current) => ({
                    ...current,
                    [key]: !(current[key] ?? false),
                  }))
                }
              />
            );
          })}
        </div>
      ) : (
        <div className="panel-scroll space-y-4 pr-1">
          {entry.url && (
            <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] p-4">
              <div className="section-kicker">{copy.origin}</div>
              <a
                href={entry.url}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 block break-all text-sm font-medium text-[var(--accent)] hover:underline"
              >
                {entry.url}
              </a>
            </div>
          )}
          {entry.content && (
            <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] p-4 text-sm leading-7 text-slate-300">
              {entry.content}
            </div>
          )}
          {entry.metadata && Object.keys(entry.metadata).length > 0 && (
            <div className="rounded-lg border border-[var(--border)] bg-slate-900/80 p-4">
              <div className="section-kicker">{copy.metadata}</div>
              <pre className="mt-3 overflow-x-auto text-xs leading-6 text-slate-300">
                {JSON.stringify(entry.metadata, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
