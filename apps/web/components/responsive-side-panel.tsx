'use client'

import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface ResponsiveSidePanelProps {
  children: ReactNode
  onDismiss: () => void
  className?: string
}

export function ResponsiveSidePanel({
  children,
  onDismiss,
  className,
}: ResponsiveSidePanelProps) {
  return (
    <>
      <button
        type="button"
        aria-label="Dismiss detail panel"
        onClick={onDismiss}
        className="fixed inset-0 z-40 bg-ink/35 lg:hidden"
      />
      <div className={cn('fixed inset-0 z-50 min-h-0 overflow-hidden lg:static lg:z-auto lg:overflow-visible', className)}>
        {children}
      </div>
    </>
  )
}
