'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'
import type { DisplaySegment } from '@/lib/types'
import { ChevronRight, Eye, EyeOff, Copy, Check } from 'lucide-react'

interface MaskedContentProps {
  segments: DisplaySegment[]
  className?: string
}

/**
 * MaskedContent - Renders display segments with inline expand/collapse for masked content
 * 
 * Handles:
 * - Normal text segments
 * - Masked segments (system prompts, large file content, etc.) with inline expand
 * - Highlighted segments (search matches)
 * - Code blocks
 */
export function MaskedContent({ segments, className }: MaskedContentProps) {
  return (
    <div className={cn('text-sm leading-relaxed', className)}>
      {segments.map((segment, index) => (
        <SegmentRenderer key={index} segment={segment} />
      ))}
    </div>
  )
}

function SegmentRenderer({ segment }: { segment: DisplaySegment }) {
  switch (segment.type) {
    case 'masked':
      return <MaskedSegment segment={segment} />
    case 'highlight':
      return <HighlightSegment segment={segment} />
    case 'code':
      return <CodeSegment segment={segment} />
    case 'injected':
      return <InjectedSegment segment={segment} />
    case 'reference':
      return <ReferenceSegment segment={segment} />
    case 'text':
    default:
      return <TextSegment segment={segment} />
  }
}

function TextSegment({ segment }: { segment: DisplaySegment }) {
  // Handle newlines by splitting and inserting <br />
  const parts = segment.content.split('\n')
  return (
    <>
      {parts.map((part, i) => (
        <span key={i}>
          {part}
          {i < parts.length - 1 && <br />}
        </span>
      ))}
    </>
  )
}

function MaskedSegment({ segment }: { segment: DisplaySegment }) {
  const [isExpanded, setIsExpanded] = useState(false)
  const [copied, setCopied] = useState(false)
  
  const handleCopy = async () => {
    if (segment.original_content) {
      try {
        await navigator.clipboard.writeText(segment.original_content)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      } catch {
        // Clipboard API unavailable (non-HTTPS or unfocused document)
      }
    }
  }
  
  if (isExpanded && segment.original_content) {
    return (
      <div className="my-2 border border-border bg-paper">
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-surface-hover">
          <button
            type="button"
            onClick={() => setIsExpanded(false)}
            className="flex items-center gap-1.5 text-xs stamp-text text-muted hover:text-ink"
          >
            <ChevronRight className="w-3 h-3 rotate-90" />
            <span>{segment.mask_label}</span>
            <span className="mono-text font-normal">
              ({formatCharCount(segment.mask_char_count || 0)})
            </span>
          </button>
          
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleCopy}
              className="p-1 text-muted hover:text-ink"
              title="Copy content"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-success" /> : <Copy className="w-3.5 h-3.5" />}
            </button>
            <button
              type="button"
              onClick={() => setIsExpanded(false)}
              className="p-1 text-muted hover:text-ink"
              title="Collapse"
            >
              <EyeOff className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
        
        {/* Content with max-height and scroll */}
        <div className="max-h-64 overflow-y-auto">
          <pre className="p-3 text-xs mono-text whitespace-pre-wrap break-words text-text">
            {segment.original_content}
          </pre>
        </div>
      </div>
    )
  }
  
  return (
    <button
      type="button"
      onClick={() => setIsExpanded(true)}
      className={cn(
        "inline-flex items-center gap-1 px-1.5 py-0.5 mx-0.5",
        "text-xs mono-text",
        "bg-muted/10 border border-border hover:border-ink hover:bg-surface-hover",
        "transition-colors cursor-pointer"
      )}
      title="Click to expand"
    >
      <Eye className="w-3 h-3 text-muted" />
      <span className="text-muted">[MASKED: {segment.mask_label}</span>
      <span className="text-muted/70">- {formatCharCount(segment.mask_char_count || 0)}]</span>
    </button>
  )
}

function HighlightSegment({ segment }: { segment: DisplaySegment }) {
  const bgColor = segment.highlight_type === 'error' 
    ? 'bg-warning/20' 
    : segment.highlight_type === 'diff'
    ? 'bg-success/20'
    : 'bg-candidate/20'
  
  return (
    <mark className={cn('px-0.5', bgColor)}>
      {segment.content}
    </mark>
  )
}

function CodeSegment({ segment }: { segment: DisplaySegment }) {
  return (
    <code className="px-1 py-0.5 bg-surface-hover mono-text text-xs">
      {segment.content}
    </code>
  )
}

function InjectedSegment({ segment }: { segment: DisplaySegment }) {
  return (
    <span className="text-muted italic">
      {segment.content}
    </span>
  )
}

function ReferenceSegment({ segment }: { segment: DisplaySegment }) {
  return (
    <span className="text-accent hover:underline cursor-pointer">
      {segment.content}
    </span>
  )
}

function formatCharCount(count: number): string {
  if (count < 1000) return `${count} chars`
  return `${(count / 1000).toFixed(1)}k chars`
}

// =============================================================================
// Simplified display for list views
// =============================================================================

interface MaskedContentPreviewProps {
  segments: DisplaySegment[]
  maxLength?: number
  className?: string
}

/**
 * MaskedContentPreview - Simplified view for list items
 * Shows masked placeholders but doesn't allow expand
 */
export function MaskedContentPreview({ 
  segments, 
  maxLength = 200,
  className 
}: MaskedContentPreviewProps) {
  let totalLength = 0
  const truncatedSegments: DisplaySegment[] = []
  
  for (const segment of segments) {
    if (totalLength >= maxLength) break
    
    if (segment.type === 'masked') {
      // Show a compact placeholder for masked content
      truncatedSegments.push({
        ...segment,
        content: `[${segment.mask_label}]`,
      })
      totalLength += 20 // Approximate length of placeholder
    } else {
      const remaining = maxLength - totalLength
      if (segment.content.length <= remaining) {
        truncatedSegments.push(segment)
        totalLength += segment.content.length
      } else {
        truncatedSegments.push({
          ...segment,
          content: segment.content.slice(0, remaining) + '...',
        })
        totalLength = maxLength
      }
    }
  }
  
  return (
    <div className={cn('text-sm leading-6 text-text', className)}>
      {truncatedSegments.map((segment, index) => (
        <span 
          key={index}
          className={cn(
            segment.type === 'masked' && 'text-muted mono-text text-xs',
            segment.type === 'highlight' && 'bg-candidate/20 px-0.5'
          )}
        >
          {segment.content}
        </span>
      ))}
    </div>
  )
}
