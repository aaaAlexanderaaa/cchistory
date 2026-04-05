'use client'

import { Fragment, useMemo, useState, type ReactNode } from 'react'
import { formatTokenUsageSummary } from '@/lib/token-usage'
import { cn } from '@/lib/utils'
import { useTurnLineageQuery } from '@/lib/api'
import type {
  AssistantReply,
  DisplaySegment,
  ProjectIdentity,
  Session,
  ToolCall,
  TurnContext,
  UserTurn,
} from '@/lib/types'
import { MaskedContent, MaskedContentPreview } from './masked-content'
import { SessionBadge } from './session-badge'
import {
  AlertCircle,
  Bot,
  ChevronDown,
  ChevronRight,
  Clock,
  Database,
  ExternalLink,
  FolderTree,
  GitBranch,
  GitCommit,
  HelpCircle,
  Link2Off,
  MessageSquare,
  User,
  Wrench,
  X,
} from 'lucide-react'
import { format } from 'date-fns'

interface TurnDetailPanelProps {
  turn: UserTurn
  context?: TurnContext
  session?: Session
  project?: ProjectIdentity
  onClose: () => void
  onOpenSession?: () => void
  className?: string
}

type TimelineEntry =
  | { kind: 'reply'; id: string; sortKey: number; order: number; reply: AssistantReply }
  | { kind: 'tool'; id: string; sortKey: number; order: number; toolCall: ToolCall }

export function TurnDetailPanel({
  turn,
  context,
  session,
  project,
  onClose,
  onOpenSession,
  className,
}: TurnDetailPanelProps) {
  const [expandedSections, setExpandedSections] = useState<Set<string>>(() => createInitialExpandedSections(turn))
  const [expandedToolCalls, setExpandedToolCalls] = useState<Set<string>>(new Set())
  const { data: lineage } = useTurnLineageQuery(turn.id)

  const toggleSection = (id: string) => {
    setExpandedSections((previous) => {
      const next = new Set(previous)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const toggleToolCall = (id: string) => {
    setExpandedToolCalls((previous) => {
      const next = new Set(previous)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const systemMessageCount = context?.system_messages.length ?? 0
  const assistantReplyCount = context?.assistant_replies.length ?? 0
  const toolCallCount = context?.tool_calls.length ?? 0
  const tokenSummary = formatTokenUsageSummary(
    turn.context_summary.token_usage,
    (turn.context_summary.token_usage || turn.context_summary.total_tokens !== undefined) ? 1 : 0,
    1,
    turn.context_summary.total_tokens,
  )
  const hasComplexUserInput = turn.user_messages.length > 1 || turn.user_messages.some((message) => message.is_injected)
  const userInputBadge = turn.user_messages.length === 1 ? '1 message' : `${turn.user_messages.length} messages`

  const timelineEntries = useMemo<TimelineEntry[]>(() => {
    if (!context) {
      return []
    }

    const replyOrder = new Map(context.assistant_replies.map((reply, index) => [reply.id, index]))
    const replyEntries: TimelineEntry[] = context.assistant_replies.map((reply, index) => ({
      kind: 'reply',
      id: reply.id,
      sortKey: reply.created_at.getTime(),
      order: index * 2,
      reply,
    }))
    const toolEntries: TimelineEntry[] = context.tool_calls.map((toolCall, index) => ({
      kind: 'tool',
      id: toolCall.id,
      sortKey: toolCall.created_at.getTime(),
      order: (replyOrder.get(toolCall.reply_id) ?? index + context.assistant_replies.length) * 2 + 1,
      toolCall,
    }))

    return [...replyEntries, ...toolEntries].sort((left, right) => {
      if (left.sortKey !== right.sortKey) {
        return left.sortKey - right.sortKey
      }
      return left.order - right.order
    })
  }, [context])

  return (
    <div className={cn('flex h-full min-h-0 flex-col border-l border-border bg-card', className)}>
      <div className="flex-shrink-0 border-b border-border">
        <div className="flex items-start justify-between gap-3 px-4 py-3">
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <LinkStateBadge state={turn.link_state} confidence={turn.project_confidence} />
              {project && (
                <span
                  className="px-2 py-0.5 text-xs font-medium"
                  style={{
                    backgroundColor: `${project.color}15`,
                    color: project.color,
                  }}
                >
                  {project.name}
                </span>
              )}
            </div>
            <MaskedContentPreview
              segments={turn.display_segments}
              maxLength={280}
              className="line-clamp-4 text-sm leading-6 text-ink"
            />
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close turn detail"
            className="p-1.5 text-muted transition-colors hover:bg-surface-hover hover:text-ink"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-4 px-4 pb-3 text-xs text-muted">
          <span className="flex items-center gap-1">
            <Clock className="w-3 h-3" />
            {format(turn.created_at, 'yyyy-MM-dd HH:mm')}
          </span>
          <span className="flex items-center gap-1">
            <MessageSquare className="w-3 h-3" />
            {assistantReplyCount} replies
          </span>
          <span className="flex items-center gap-1">
            <Wrench className="w-3 h-3" />
            {toolCallCount} tool calls
          </span>
          <span className="flex items-center gap-1 mono-text">
            <Database className="w-3 h-3" />
            {tokenSummary}
          </span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <CollapsibleSection
          id="user-input"
          title="User Input"
          icon={<User className="w-4 h-4" />}
          badge={userInputBadge}
          isExpanded={expandedSections.has('user-input')}
          onToggle={() => toggleSection('user-input')}
          defaultCollapsed={!hasComplexUserInput}
        >
          <div className="space-y-3">
            {turn.user_messages.map((message, index) => (
              <div
                key={message.id}
                className={cn(
                  'border border-border bg-paper p-3',
                  message.is_injected && 'border-dashed',
                )}
              >
                <div className="mb-2 flex items-center gap-2 text-[10px] stamp-text text-muted">
                  <span>MESSAGE {index + 1}</span>
                  {message.is_injected && <span className="text-warning">INJECTED</span>}
                </div>
                <MaskedContent segments={message.display_segments} className="break-words text-sm text-text" />
              </div>
            ))}
          </div>
        </CollapsibleSection>

        {systemMessageCount > 0 && context?.system_messages && (
          <CollapsibleSection
            id="system-messages"
            title="System Messages"
            icon={<AlertCircle className="w-4 h-4" />}
            badge={`${systemMessageCount} messages`}
            isExpanded={expandedSections.has('system-messages')}
            onToggle={() => toggleSection('system-messages')}
            defaultCollapsed
          >
            <div className="space-y-3">
              {context.system_messages.map((message) => (
                <div key={message.id} className="border border-dashed border-border bg-paper p-3">
                  <div className="mb-2 text-[10px] stamp-text text-muted">
                    POSITION: {message.position.replace('_', ' ').toUpperCase()}
                  </div>
                  <MaskedContent segments={message.display_segments} />
                </div>
              ))}
            </div>
          </CollapsibleSection>
        )}

        {timelineEntries.length > 0 && (
          <CollapsibleSection
            id="assistant-timeline"
            title="Assistant + Tool Timeline"
            icon={<Bot className="w-4 h-4" />}
            badge={`${assistantReplyCount} replies, ${toolCallCount} tools`}
            isExpanded={expandedSections.has('assistant-timeline')}
            onToggle={() => toggleSection('assistant-timeline')}
          >
            <div className="space-y-3">
              {timelineEntries.map((entry, index) => (
                <div key={entry.id} className="relative">
                  {index < timelineEntries.length - 1 && (
                    <div className="absolute left-[7px] top-8 bottom-0 w-px bg-border" />
                  )}

                  {entry.kind === 'reply' ? (
                    <AssistantTimelineItem reply={entry.reply} index={index + 1} />
                  ) : (
                    <ToolTimelineItem
                      toolCall={entry.toolCall}
                      index={index + 1}
                      isExpanded={expandedToolCalls.has(entry.toolCall.id)}
                      onToggle={() => toggleToolCall(entry.toolCall.id)}
                    />
                  )}
                </div>
              ))}
            </div>
          </CollapsibleSection>
        )}

        {project && (
          <CollapsibleSection
            id="project-context"
            title="Project Context"
            icon={<FolderTree className="w-4 h-4" />}
            badge={project.linkage_state === 'candidate' ? 'candidate evidence' : 'committed context'}
            isExpanded={expandedSections.has('project-context')}
            onToggle={() => toggleSection('project-context')}
            defaultCollapsed
          >
            <div className="space-y-3 text-sm">
              <div className="border border-border bg-paper p-3">
                <div className="mb-1 text-[10px] stamp-text text-muted">PROJECT</div>
                <div className="text-ink">{project.name}</div>
                <div className="mt-1 text-xs text-muted">
                  {project.linkage_state === 'candidate'
                    ? `Candidate evidence via ${formatLinkReason(project.link_reason)}`
                    : `Committed context via ${formatLinkReason(project.link_reason)}`}
                </div>
              </div>

              {project.primary_workspace_path && (
                <div className="flex items-start gap-2 border border-border bg-paper p-3 text-xs text-muted">
                  <FolderTree className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                  <span className="mono-text break-all">{project.primary_workspace_path}</span>
                </div>
              )}

              {project.primary_repo_remote && (
                <div className="flex items-start gap-2 border border-border bg-paper p-3 text-xs text-muted">
                  <GitBranch className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                  <span className="break-all">{project.primary_repo_remote}</span>
                </div>
              )}
            </div>
          </CollapsibleSection>
        )}

        {lineage && (
          <CollapsibleSection
            id="lineage"
            title="Lineage Debug"
            icon={<GitCommit className="w-4 h-4" />}
            badge={`${lineage.atoms.length} atoms, ${lineage.fragments.length} fragments`}
            isExpanded={expandedSections.has('lineage')}
            onToggle={() => toggleSection('lineage')}
            defaultCollapsed
          >
            <div className="grid grid-cols-2 gap-3 text-xs">
              <LineageMetric label="Candidates" value={lineage.candidate_chain.length} />
              <LineageMetric label="Atoms" value={lineage.atoms.length} />
              <LineageMetric label="Edges" value={lineage.edges.length} />
              <LineageMetric label="Fragments" value={lineage.fragments.length} />
              <LineageMetric label="Records" value={lineage.records.length} />
              <LineageMetric label="Blobs" value={lineage.blobs.length} />
            </div>
          </CollapsibleSection>
        )}
      </div>

      {session && (
        <div className="flex-shrink-0 border-t border-border px-4 py-3">
          <button
            type="button"
            onClick={onOpenSession}
            aria-label="Open session detail"
            className="flex w-full items-center gap-2 text-sm text-muted transition-colors hover:text-accent"
          >
            <span className="text-[10px] stamp-text">SESSION:</span>
            <SessionBadge session={session} className="max-w-full flex-1" />
            <ExternalLink className="ml-auto h-3 w-3 flex-shrink-0" />
          </button>
        </div>
      )}
    </div>
  )
}

interface CollapsibleSectionProps {
  id: string
  title: string
  icon: ReactNode
  badge?: string
  children: ReactNode
  isExpanded: boolean
  onToggle: () => void
  defaultCollapsed?: boolean
}

function CollapsibleSection({
  title,
  icon,
  badge,
  children,
  isExpanded,
  onToggle,
  defaultCollapsed,
}: CollapsibleSectionProps) {
  return (
    <div className="border-b border-border">
      <button
        type="button"
        onClick={onToggle}
        className={cn(
          'flex w-full items-start gap-2 px-4 py-3 text-left transition-colors hover:bg-surface-hover',
          defaultCollapsed && !isExpanded && 'bg-surface-hover/50',
        )}
      >
        {isExpanded ? (
          <ChevronDown className="mt-0.5 w-4 h-4 flex-shrink-0 text-muted" />
        ) : (
          <ChevronRight className="mt-0.5 w-4 h-4 flex-shrink-0 text-muted" />
        )}
        <span className="mt-0.5 flex-shrink-0">{icon}</span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">{title}</span>
          {badge && <span className="mt-0.5 block text-[10px] mono-text text-muted sm:hidden">{badge}</span>}
        </span>
        {badge && <span className="ml-auto hidden pt-0.5 text-[10px] mono-text text-muted sm:block">{badge}</span>}
      </button>

      {isExpanded && <div className="px-4 pb-4">{children}</div>}
    </div>
  )
}

function createInitialExpandedSections(turn: UserTurn) {
  const sections = new Set<string>(['assistant-timeline'])
  const hasComplexUserInput = turn.user_messages.length > 1 || turn.user_messages.some((message) => message.is_injected)

  if (hasComplexUserInput) {
    sections.add('user-input')
  }

  return sections
}

function AssistantTimelineItem({ reply, index }: { reply: AssistantReply; index: number }) {
  const renderReadableReply = shouldRenderReadableReply(reply.display_segments, reply.content)

  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <div className="flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full bg-accent">
          <Bot className="h-2.5 w-2.5 text-white" />
        </div>
        <span className="text-[10px] stamp-text text-muted">REPLY {index}</span>
        <span className="text-[10px] mono-text text-muted">{reply.model}</span>
        {reply.stop_reason && (
          <span className="bg-surface-hover px-1 py-0.5 text-[10px] mono-text text-muted">{reply.stop_reason}</span>
        )}
      </div>

      <div className="ml-6 border border-border bg-paper p-4">
        {renderReadableReply ? (
          <ReadableReplyContent content={reply.content} />
        ) : (
          <MaskedContent segments={reply.display_segments} />
        )}
      </div>
    </div>
  )
}

function ToolTimelineItem({
  toolCall,
  index,
  isExpanded,
  onToggle,
}: {
  toolCall: ToolCall
  index: number
  isExpanded: boolean
  onToggle: () => void
}) {
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        className={cn(
          'ml-6 flex w-[calc(100%-1.5rem)] items-center gap-2 border border-border bg-card px-3 py-2 text-left transition-colors hover:bg-surface-hover',
          isExpanded && 'bg-surface-hover',
        )}
      >
        {isExpanded ? (
          <ChevronDown className="h-3 w-3 flex-shrink-0 text-muted" />
        ) : (
          <ChevronRight className="h-3 w-3 flex-shrink-0 text-muted" />
        )}
        <Wrench className="h-3.5 w-3.5 flex-shrink-0 text-muted" />
        <span className="text-[10px] mono-text text-muted">{index}.</span>
        <span className="text-xs font-medium text-ink">{toolCall.tool_name}</span>
        <span className="flex-1 truncate text-xs text-muted">{toolCall.input_summary}</span>
        <span className={cn('text-[10px] stamp-text', toolCall.status === 'error' ? 'text-warning' : 'text-muted')}>
          {toolCall.status}
        </span>
      </button>

      {isExpanded && (
        <div className="ml-6 w-[calc(100%-1.5rem)] border-x border-b border-border">
          <div className="border-t border-border bg-paper p-3">
            <div className="mb-2 text-[10px] stamp-text text-muted">INPUT</div>
            {toolCall.input_display_segments && toolCall.input_display_segments.length > 0 ? (
              <MaskedContent segments={toolCall.input_display_segments} />
            ) : (
              <pre className="whitespace-pre-wrap break-all text-xs mono-text text-text">
                {JSON.stringify(toolCall.input, null, 2)}
              </pre>
            )}
          </div>

          {(toolCall.output || toolCall.error_message) && (
            <div className={cn('border-t border-border p-3', toolCall.status === 'error' ? 'bg-warning/5' : 'bg-card')}>
              <div className={cn('mb-2 text-[10px] stamp-text', toolCall.status === 'error' ? 'text-warning' : 'text-muted')}>
                {toolCall.status === 'error' ? 'ERROR' : 'OUTPUT'}
              </div>
              {toolCall.status === 'error' && toolCall.error_message ? (
                <pre className="whitespace-pre-wrap break-all text-xs mono-text text-warning">{toolCall.error_message}</pre>
              ) : toolCall.output_display_segments && toolCall.output_display_segments.length > 0 ? (
                <MaskedContent segments={toolCall.output_display_segments} />
              ) : (
                <pre className="whitespace-pre-wrap break-all text-xs mono-text text-text">{toolCall.output}</pre>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function LineageMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="border border-border bg-paper p-3">
      <div className="text-[10px] stamp-text text-muted">{label}</div>
      <div className="mt-1 text-lg font-bold font-display text-ink">{value}</div>
    </div>
  )
}

function LinkStateBadge({
  state,
  confidence,
}: {
  state: UserTurn['link_state']
  confidence?: number
}) {
  switch (state) {
    case 'committed':
      return (
        <span className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] stamp-text bg-success/10 text-success">
          <GitCommit className="w-3 h-3" />
          COMMITTED
        </span>
      )
    case 'candidate':
      return (
        <span className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] stamp-text bg-candidate/10 text-candidate">
          <HelpCircle className="w-3 h-3" />
          CANDIDATE
          {confidence !== undefined && (
            <span className="mono-text font-normal">({(confidence * 100).toFixed(0)}%)</span>
          )}
        </span>
      )
    case 'unlinked':
      return (
        <span className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] stamp-text bg-muted/10 text-muted">
          <Link2Off className="w-3 h-3" />
          UNLINKED
        </span>
      )
  }
}

function formatLinkReason(reason: ProjectIdentity['link_reason']) {
  switch (reason) {
    case 'repo_fingerprint_match':
      return 'repo fingerprint'
    case 'repo_remote_match':
      return 'repo remote'
    case 'repo_root_match':
      return 'repo root'
    case 'workspace_path_continuity':
      return 'workspace path'
    case 'source_native_project':
      return 'source-native project'
    case 'manual_override':
      return 'manual override'
    case 'weak_path_hint':
      return 'weak path hint'
    case 'metadata_hint':
      return 'metadata hint'
  }
}

type ReadableBlock =
  | { type: 'heading'; level: number; content: string }
  | { type: 'paragraph'; content: string }
  | { type: 'list'; ordered: boolean; items: string[] }
  | { type: 'quote'; content: string }
  | { type: 'code'; language?: string; content: string }

function ReadableReplyContent({ content }: { content: string }) {
  const blocks = useMemo(() => parseReadableBlocks(content), [content])

  if (blocks.length === 0) {
    return <div className="whitespace-pre-wrap break-words text-sm leading-7 text-text">{content}</div>
  }

  return (
    <div className="space-y-4 text-sm text-text">
      {blocks.map((block, index) => {
        if (block.type === 'heading') {
          return (
            <h3
              key={`${block.type}-${index}`}
              className={cn(
                'font-display font-bold text-ink',
                block.level === 1 ? 'text-lg' : block.level === 2 ? 'text-base' : 'text-sm',
              )}
            >
              {renderInlineCode(block.content)}
            </h3>
          )
        }

        if (block.type === 'quote') {
          return (
            <blockquote
              key={`${block.type}-${index}`}
              className="border-l-2 border-border pl-3 text-sm leading-7 text-muted"
            >
              {renderInlineCode(block.content)}
            </blockquote>
          )
        }

        if (block.type === 'code') {
          return (
            <div key={`${block.type}-${index}`} className="overflow-hidden border border-border bg-ink text-card">
              <div className="border-b border-card/15 px-3 py-2 text-[10px] stamp-text text-card/75">
                {block.language || 'code'}
              </div>
              <pre className="overflow-x-auto px-4 py-3 text-xs leading-6 mono-text whitespace-pre-wrap">
                {block.content}
              </pre>
            </div>
          )
        }

        if (block.type === 'list') {
          const ListTag = block.ordered ? 'ol' : 'ul'
          return (
            <ListTag
              key={`${block.type}-${index}`}
              className={cn(
                'space-y-2 pl-5 text-[15px] leading-7 text-text',
                block.ordered ? 'list-decimal' : 'list-disc',
              )}
            >
              {block.items.map((item, itemIndex) => (
                <li key={`${block.type}-${index}-${itemIndex}`}>{renderInlineCode(item)}</li>
              ))}
            </ListTag>
          )
        }

        return (
          <p key={`${block.type}-${index}`} className="whitespace-pre-wrap text-[15px] leading-7 text-text">
            {renderInlineCode(block.content)}
          </p>
        )
      })}
    </div>
  )
}

function shouldRenderReadableReply(segments: DisplaySegment[], content: string) {
  if (!content.trim()) {
    return false
  }

  if (segments.length === 0) {
    return true
  }

  return segments.every((segment) => segment.type === 'text')
}

function parseReadableBlocks(content: string): ReadableBlock[] {
  const lines = content.replace(/\r\n/g, '\n').trim().split('\n')

  if (lines.length === 1 && lines[0] === '') {
    return []
  }

  const blocks: ReadableBlock[] = []
  let index = 0

  while (index < lines.length) {
    const line = lines[index] ?? ''
    const trimmed = line.trim()

    if (!trimmed) {
      index += 1
      continue
    }

    const codeFenceMatch = trimmed.match(/^```([^\s`]*)\s*$/)
    if (codeFenceMatch) {
      index += 1
      const codeLines: string[] = []
      while (index < lines.length && !lines[index]!.trim().startsWith('```')) {
        codeLines.push(lines[index]!)
        index += 1
      }
      if (index < lines.length) {
        index += 1
      }
      blocks.push({
        type: 'code',
        language: codeFenceMatch[1] || undefined,
        content: codeLines.join('\n').trimEnd(),
      })
      continue
    }

    const headingMatch = trimmed.match(/^(#{1,3})\s+(.*)$/)
    if (headingMatch) {
      blocks.push({
        type: 'heading',
        level: headingMatch[1].length,
        content: headingMatch[2],
      })
      index += 1
      continue
    }

    const quoteMatch = trimmed.match(/^>\s?(.*)$/)
    if (quoteMatch) {
      const quoteLines: string[] = []
      while (index < lines.length) {
        const current = lines[index]!.trim()
        const currentQuote = current.match(/^>\s?(.*)$/)
        if (!currentQuote) {
          break
        }
        quoteLines.push(currentQuote[1])
        index += 1
      }
      blocks.push({ type: 'quote', content: quoteLines.join('\n').trim() })
      continue
    }

    const listMatch = trimmed.match(/^([-*]|\d+\.)\s+(.*)$/)
    if (listMatch) {
      const ordered = /\d+\./.test(listMatch[1])
      const items: string[] = []
      while (index < lines.length) {
        const current = lines[index]!.trim()
        const currentMatch = current.match(/^([-*]|\d+\.)\s+(.*)$/)
        if (!currentMatch) {
          break
        }
        items.push(currentMatch[2])
        index += 1
      }
      blocks.push({ type: 'list', ordered, items })
      continue
    }

    const paragraphLines: string[] = [line]
    index += 1
    while (index < lines.length) {
      const current = lines[index] ?? ''
      const currentTrimmed = current.trim()
      if (!currentTrimmed) {
        index += 1
        break
      }
      if (
        /^```/.test(currentTrimmed) ||
        /^(#{1,3})\s+/.test(currentTrimmed) ||
        /^>\s?/.test(currentTrimmed) ||
        /^([-*]|\d+\.)\s+/.test(currentTrimmed)
      ) {
        break
      }
      paragraphLines.push(current)
      index += 1
    }
    blocks.push({ type: 'paragraph', content: paragraphLines.join('\n').trim() })
  }

  return blocks
}

function renderInlineCode(content: string) {
  return content
    .split(/(`[^`]+`)/g)
    .filter(Boolean)
    .map((part, index) =>
      part.startsWith('`') && part.endsWith('`') ? (
        <code key={index} className="rounded-sm bg-surface-hover px-1 py-0.5 mono-text text-[12px] text-ink">
          {part.slice(1, -1)}
        </code>
      ) : (
        <Fragment key={index}>{part}</Fragment>
      ),
    )
}
