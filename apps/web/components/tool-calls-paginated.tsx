'use client'

import { createElement, useMemo, useState } from 'react'
import { cn } from '@/lib/utils'
import type { ToolCall } from '@/lib/types'
import { MaskedContent } from './masked-content'
import { 
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Check,
  X,
  Clock,
  FileText,
  Edit3,
  Search,
  Terminal,
  Globe,
  FolderOpen,
  Copy,
  Loader2,
} from 'lucide-react'

interface ToolCallsPaginatedProps {
  toolCalls: ToolCall[]
  pageSize?: number
  className?: string
}

/**
 * ToolCallsPaginated - Displays tool calls with time-ordered pagination
 * 
 * Design inspired by Claude Code and Codex CLI:
 * - Tool calls shown in chronological order
 * - Each tool call is expandable to show input/output
 * - Pagination for large numbers of tool calls
 * - Visual indicators for tool type and status
 */
export function ToolCallsPaginated({ 
  toolCalls, 
  pageSize = 10,
  className 
}: ToolCallsPaginatedProps) {
  const [currentPage, setCurrentPage] = useState(0)
  const [expandedCalls, setExpandedCalls] = useState<Set<string>>(new Set())
  
  // Sort by sequence/created_at
  const sortedCalls = useMemo(() => {
    return [...toolCalls].sort((a, b) => a.sequence - b.sequence)
  }, [toolCalls])
  
  const totalPages = Math.ceil(sortedCalls.length / pageSize)
  const startIdx = currentPage * pageSize
  const pageItems = sortedCalls.slice(startIdx, startIdx + pageSize)
  
  const toggleExpand = (id: string) => {
    setExpandedCalls(prev => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }
  
  const expandAll = () => {
    setExpandedCalls(new Set(pageItems.map(tc => tc.id)))
  }
  
  const collapseAll = () => {
    setExpandedCalls(new Set())
  }
  
  if (toolCalls.length === 0) {
    return null
  }
  
  return (
    <div className={cn('', className)}>
      {/* Header with pagination */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-[10px] stamp-text text-muted">
            TOOL CALLS
          </span>
          <span className="text-[10px] mono-text text-muted">
            ({sortedCalls.length} total)
          </span>
        </div>
        
        <div className="flex items-center gap-2">
          {/* Expand/Collapse all */}
          <button
            type="button"
            onClick={expandAll}
            className="text-[10px] text-muted hover:text-ink"
          >
            Expand All
          </button>
          <span className="text-muted">|</span>
          <button
            type="button"
            onClick={collapseAll}
            className="text-[10px] text-muted hover:text-ink"
          >
            Collapse All
          </button>
          
          {/* Pagination */}
          {totalPages > 1 && (
            <>
              <span className="text-muted mx-2">|</span>
              <button
                type="button"
                onClick={() => setCurrentPage(p => Math.max(0, p - 1))}
                disabled={currentPage === 0}
                className="p-0.5 text-muted hover:text-ink disabled:opacity-30"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="text-[10px] mono-text text-muted">
                {currentPage + 1} / {totalPages}
              </span>
              <button
                type="button"
                onClick={() => setCurrentPage(p => Math.min(totalPages - 1, p + 1))}
                disabled={currentPage === totalPages - 1}
                className="p-0.5 text-muted hover:text-ink disabled:opacity-30"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </>
          )}
        </div>
      </div>
      
      {/* Tool calls list */}
      <div className="space-y-1">
        {pageItems.map((toolCall, idx) => (
          <ToolCallItem
            key={toolCall.id}
            toolCall={toolCall}
            index={startIdx + idx + 1}
            isExpanded={expandedCalls.has(toolCall.id)}
            onToggle={() => toggleExpand(toolCall.id)}
          />
        ))}
      </div>
    </div>
  )
}

// =============================================================================
// Single Tool Call Item
// =============================================================================

interface ToolCallItemProps {
  toolCall: ToolCall
  index: number
  isExpanded: boolean
  onToggle: () => void
}

function ToolCallItem({ toolCall, index, isExpanded, onToggle }: ToolCallItemProps) {
  const toolIcon = getToolIcon(toolCall.tool_name)
  const statusColor = getStatusColor(toolCall.status)
  
  return (
    <div className="border border-border">
      {/* Header - always visible */}
      <button
        type="button"
        onClick={onToggle}
        className={cn(
          'w-full flex items-center gap-2 px-2 py-1.5 text-left',
          'hover:bg-surface-hover transition-colors',
          isExpanded && 'bg-surface-hover'
        )}
      >
        <ChevronDown 
          className={cn(
            'w-3 h-3 text-muted transition-transform flex-shrink-0',
            !isExpanded && '-rotate-90'
          )} 
        />
        
        {/* Index */}
        <span className="w-5 text-[10px] mono-text text-muted flex-shrink-0">
          {index}.
        </span>
        
        {/* Tool icon */}
        {createElement(toolIcon, { className: 'w-3.5 h-3.5 text-muted flex-shrink-0' })}
        
        {/* Tool name */}
        <span className="text-xs font-medium text-ink">
          {toolCall.tool_name}
        </span>
        
        {/* Summary */}
        <span className="flex-1 text-xs text-muted truncate">
          {toolCall.input_summary}
        </span>
        
        {/* Status */}
        <span className={cn('flex-shrink-0', statusColor)}>
          {toolCall.status === 'success' && <Check className="w-3.5 h-3.5" />}
          {toolCall.status === 'error' && <X className="w-3.5 h-3.5" />}
          {toolCall.status === 'running' && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          {toolCall.status === 'pending' && <Clock className="w-3.5 h-3.5" />}
        </span>
        
        {/* Duration */}
        {toolCall.duration_ms !== undefined && (
          <span className="text-[10px] mono-text text-muted flex-shrink-0">
            {toolCall.duration_ms}ms
          </span>
        )}
      </button>
      
      {/* Expanded content */}
      {isExpanded && (
        <div className="border-t border-border">
          {/* Input */}
          <div className="p-2 bg-paper">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] stamp-text text-muted">INPUT</span>
              <CopyButton text={JSON.stringify(toolCall.input, null, 2)} />
            </div>
            {toolCall.input_display_segments ? (
              <MaskedContent 
                segments={toolCall.input_display_segments} 
                className="text-xs"
              />
            ) : (
              <pre className="text-xs mono-text text-text whitespace-pre-wrap break-all">
                {JSON.stringify(toolCall.input, null, 2)}
              </pre>
            )}
          </div>
          
          {/* Output */}
          {(toolCall.output || toolCall.error_message) && (
            <div className={cn(
              'p-2 border-t border-border',
              toolCall.status === 'error' ? 'bg-warning/5' : 'bg-surface-hover'
            )}>
              <div className="flex items-center justify-between mb-1">
                <span className={cn(
                  'text-[10px] stamp-text',
                  toolCall.status === 'error' ? 'text-warning' : 'text-muted'
                )}>
                  {toolCall.status === 'error' ? 'ERROR' : 'OUTPUT'}
                </span>
                {toolCall.output && <CopyButton text={toolCall.output} />}
              </div>
              {toolCall.status === 'error' && toolCall.error_message ? (
                <pre className="text-xs mono-text text-warning whitespace-pre-wrap break-all">
                  {toolCall.error_message}
                </pre>
              ) : toolCall.output_display_segments ? (
                <MaskedContent 
                  segments={toolCall.output_display_segments} 
                  className="text-xs"
                />
              ) : (
                <pre className="text-xs mono-text text-text whitespace-pre-wrap break-all max-h-48 overflow-y-auto">
                  {toolCall.output_preview || toolCall.output}
                </pre>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// =============================================================================
// Helpers
// =============================================================================

function getToolIcon(toolName: string) {
  const name = toolName.toLowerCase()
  
  if (name.includes('read') || name.includes('file')) return FileText
  if (name.includes('write') || name.includes('edit')) return Edit3
  if (name.includes('search') || name.includes('grep')) return Search
  if (name.includes('glob') || name.includes('list')) return FolderOpen
  if (name.includes('bash') || name.includes('exec') || name.includes('run')) return Terminal
  if (name.includes('web') || name.includes('fetch')) return Globe
  
  return Terminal
}

function getStatusColor(status: ToolCall['status']) {
  switch (status) {
    case 'success':
      return 'text-success'
    case 'error':
      return 'text-warning'
    case 'running':
      return 'text-accent'
    case 'pending':
    default:
      return 'text-muted'
  }
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  
  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation()
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  
  return (
    <button
      type="button"
      onClick={handleCopy}
      className="p-0.5 text-muted hover:text-ink"
      title="Copy"
    >
      {copied ? (
        <Check className="w-3 h-3 text-success" />
      ) : (
        <Copy className="w-3 h-3" />
      )}
    </button>
  )
}

// =============================================================================
// Compact Tool Calls Summary (for list views)
// =============================================================================

interface ToolCallsSummaryProps {
  toolCalls: ToolCall[]
  className?: string
}

export function ToolCallsSummary({ toolCalls, className }: ToolCallsSummaryProps) {
  // Group by tool name
  const grouped = useMemo(() => {
    const map = new Map<string, number>()
    toolCalls.forEach(tc => {
      map.set(tc.tool_name, (map.get(tc.tool_name) || 0) + 1)
    })
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1])
  }, [toolCalls])
  
  const errorCount = toolCalls.filter(tc => tc.status === 'error').length
  
  return (
    <div className={cn('flex items-center gap-2 text-[10px]', className)}>
      {grouped.slice(0, 3).map(([name, count]) => {
        const icon = getToolIcon(name)
        return (
          <span key={name} className="flex items-center gap-1 text-muted">
            {createElement(icon, { className: 'w-3 h-3' })}
            <span className="mono-text">{count}</span>
          </span>
        )
      })}
      {grouped.length > 3 && (
        <span className="text-muted">+{grouped.length - 3} more</span>
      )}
      {errorCount > 0 && (
        <span className="flex items-center gap-1 text-warning">
          <X className="w-3 h-3" />
          <span className="mono-text">{errorCount}</span>
        </span>
      )}
    </div>
  )
}
