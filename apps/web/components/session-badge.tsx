'use client'

import { PanelsTopLeft } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Session } from '@/lib/types'

interface SessionBadgeProps {
  session: Session
  compact?: boolean
  className?: string
  showPlatform?: boolean
  showTurnCount?: boolean
  showTitle?: boolean
}

export function SessionBadge({
  session,
  compact = false,
  className,
  showPlatform,
  showTurnCount = true,
  showTitle = true,
}: SessionBadgeProps) {
  const shouldShowPlatform = showPlatform ?? !compact

  return (
    <span
      className={cn(
        'inline-flex min-w-0 items-center gap-1.5 border border-border bg-paper px-2 py-1 text-[10px] text-muted',
        className,
      )}
    >
      <PanelsTopLeft className="h-3 w-3 flex-shrink-0" />
      {showTitle && <span className="truncate">{session.title || `Session ${session.id.slice(0, 8)}`}</span>}
      {shouldShowPlatform && <span className="mono-text text-[9px] uppercase">{formatSourcePlatform(session.source_platform)}</span>}
      {showTurnCount && <span className="mono-text text-[9px]">{session.turn_count} turns</span>}
    </span>
  )
}

export function formatSourcePlatform(platform: Session['source_platform']) {
  switch (platform) {
    case 'claude_code':
      return 'claude'
    case 'cursor':
      return 'cursor'
    case 'factory_droid':
      return 'droid'
    case 'antigravity':
      return 'antigravity'
    case 'amp':
      return 'AMP'
    case 'openclaw':
      return 'openclaw'
    case 'opencode':
      return 'opencode'
    case 'lobechat':
      return 'lobechat'
    default:
      return platform.replace(/_/g, ' ')
  }
}
