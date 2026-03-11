'use client'

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import type { AppArea, HistoryView, AdminView } from '@/lib/types'
import {
  Search,
  Layers,
  FolderOpen,
  Inbox,
  Database,
  Activity,
  Link2,
  Shield,
  Menu,
  X,
} from 'lucide-react'

interface NavItem {
  id: string
  label: string
  icon: ReactNode
  badge?: number
}

interface AppShellProps {
  children: ReactNode
  currentArea: AppArea
  currentView: HistoryView | AdminView
  onAreaChange: (area: AppArea) => void
  onViewChange: (view: HistoryView | AdminView, area: AppArea) => void
  onOpenSearch?: () => void
  inboxCount?: number
  driftScore?: number
}

const historyNavItems: NavItem[] = [
  { id: 'all_turns', label: 'All Turns', icon: <Layers className="h-4 w-4" /> },
  { id: 'projects', label: 'Projects', icon: <FolderOpen className="h-4 w-4" /> },
]

const adminNavItems: NavItem[] = [
  { id: 'sources', label: 'Sources', icon: <Database className="h-4 w-4" /> },
  { id: 'linking', label: 'Linking', icon: <Link2 className="h-4 w-4" /> },
  { id: 'masks', label: 'Masks', icon: <Shield className="h-4 w-4" /> },
  { id: 'drift', label: 'Drift Monitor', icon: <Activity className="h-4 w-4" /> },
]

export function AppShell({
  children,
  currentArea,
  currentView,
  onAreaChange,
  onViewChange,
  onOpenSearch,
  inboxCount = 0,
  driftScore,
}: AppShellProps) {
  const [navOpen, setNavOpen] = useState(false)

  const handleSearchClick = useCallback(() => {
    setNavOpen(false)
    if (onOpenSearch) {
      onOpenSearch()
    } else {
      onViewChange('search', 'history')
    }
  }, [onOpenSearch, onViewChange])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === '/' && !e.metaKey && !e.ctrlKey) {
        const target = e.target as HTMLElement
        if (target.tagName !== 'INPUT' && target.tagName !== 'TEXTAREA') {
          e.preventDefault()
          handleSearchClick()
        }
      }
      if (e.key === 'Escape') {
        setNavOpen(false)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleSearchClick])

  const openArea = (area: AppArea) => {
    onAreaChange(area)
    setNavOpen(false)
  }

  const openView = (view: HistoryView | AdminView, area: AppArea) => {
    onAreaChange(area)
    onViewChange(view, area)
    setNavOpen(false)
  }

  return (
    <div className="flex min-h-[100svh] flex-col bg-paper lg:h-screen lg:min-h-screen lg:flex-row">
      <div className="flex h-14 items-center justify-between border-b border-border bg-card px-4 lg:hidden">
        <button
          type="button"
          onClick={() => setNavOpen(true)}
          className="flex h-9 w-9 items-center justify-center border border-border bg-paper text-muted transition-colors hover:border-ink hover:text-ink"
          aria-label="Open navigation"
        >
          <Menu className="h-4 w-4" />
        </button>

        <div className="flex min-w-0 items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center bg-ink">
            <span className="font-display text-xs font-bold text-card">CC</span>
          </div>
          <div className="min-w-0">
            <div className="text-sm font-bold font-display text-ink">CCHistory</div>
            <div className="mono-text text-[10px] text-muted">v1.0</div>
          </div>
        </div>

        <button
          type="button"
          onClick={handleSearchClick}
          className="flex h-9 w-9 items-center justify-center border border-border bg-paper text-muted transition-colors hover:border-ink hover:text-ink"
          aria-label="Open search"
        >
          <Search className="h-4 w-4" />
        </button>
      </div>

      <SidebarContent
        currentArea={currentArea}
        currentView={currentView}
        onAreaChange={openArea}
        onViewChange={openView}
        onSearchClick={handleSearchClick}
        inboxCount={inboxCount}
        driftScore={driftScore}
        className="hidden lg:flex"
      />

      {navOpen && (
        <>
          <button
            type="button"
            aria-label="Close navigation"
            onClick={() => setNavOpen(false)}
            className="fixed inset-0 z-40 bg-ink/35 lg:hidden"
          />
          <SidebarContent
            currentArea={currentArea}
            currentView={currentView}
            onAreaChange={openArea}
            onViewChange={openView}
            onSearchClick={handleSearchClick}
            inboxCount={inboxCount}
            driftScore={driftScore}
            className="fixed inset-y-0 left-0 z-50 flex w-[min(20rem,86vw)] shadow-hover lg:hidden"
            mobile
            onClose={() => setNavOpen(false)}
          />
        </>
      )}

      <main className="min-h-0 flex flex-1 flex-col overflow-hidden pb-[calc(4rem+env(safe-area-inset-bottom))] lg:pb-0">
        {children}
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-30 grid h-[calc(4rem+env(safe-area-inset-bottom))] grid-cols-4 border-t border-border bg-card pb-[env(safe-area-inset-bottom)] lg:hidden">
        <MobileNavButton
          icon={<Layers className="h-4 w-4" />}
          label="Turns"
          active={currentArea === 'history' && currentView === 'all_turns'}
          onClick={() => openView('all_turns', 'history')}
        />
        <MobileNavButton
          icon={<FolderOpen className="h-4 w-4" />}
          label="Projects"
          active={currentArea === 'history' && currentView === 'projects'}
          onClick={() => openView('projects', 'history')}
        />
        <MobileNavButton
          icon={<Inbox className="h-4 w-4" />}
          label="Inbox"
          active={currentArea === 'history' && currentView === 'inbox'}
          badge={inboxCount > 0 ? inboxCount : undefined}
          onClick={() => openView('inbox', 'history')}
        />
        <MobileNavButton
          icon={<Database className="h-4 w-4" />}
          label={currentArea === 'admin' ? 'Admin' : 'Sources'}
          active={currentArea === 'admin'}
          badge={driftScore !== undefined && driftScore > 0.1 ? Math.round(driftScore * 100) : undefined}
          onClick={() => openView('sources', 'admin')}
        />
      </nav>
    </div>
  )
}

interface SidebarContentProps {
  currentArea: AppArea
  currentView: HistoryView | AdminView
  onAreaChange: (area: AppArea) => void
  onViewChange: (view: HistoryView | AdminView, area: AppArea) => void
  onSearchClick: () => void
  inboxCount: number
  driftScore?: number
  className?: string
  mobile?: boolean
  onClose?: () => void
}

function SidebarContent({
  currentArea,
  currentView,
  onAreaChange,
  onViewChange,
  onSearchClick,
  inboxCount,
  driftScore,
  className,
  mobile = false,
  onClose,
}: SidebarContentProps) {
  return (
    <aside className={cn('w-60 flex-col border-r border-border bg-card', className)}>
      <div className="flex h-14 items-center border-b border-border px-4">
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center bg-ink">
            <span className="font-display text-xs font-bold text-card">CC</span>
          </div>
          <div className="min-w-0">
            <div className="text-sm font-bold font-display text-ink">CCHistory</div>
            <div className="mono-text text-[10px] text-muted">v1.0</div>
          </div>
        </div>

        {mobile && onClose && (
          <button
            type="button"
            onClick={onClose}
            className="ml-auto flex h-8 w-8 items-center justify-center text-muted transition-colors hover:bg-surface-hover hover:text-ink"
            aria-label="Close navigation"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      <div className="p-3">
        <button
          type="button"
          onClick={onSearchClick}
          className="flex h-9 w-full items-center gap-2 border border-border bg-paper px-3 text-sm text-muted transition-colors hover:border-ink"
        >
          <Search className="h-4 w-4" />
          <span>Search turns...</span>
          <kbd className="mono-text ml-auto border border-border bg-card px-1.5 py-0.5 text-[10px]">/</kbd>
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-2">
        <NavSection
          title="HISTORY"
          active={currentArea === 'history'}
          tone="accent"
          onSelect={() => onAreaChange('history')}
        >
          {historyNavItems.map((item) => (
            <NavButton
              key={item.id}
              item={item}
              active={currentArea === 'history' && currentView === item.id}
              onClick={() => onViewChange(item.id as HistoryView, 'history')}
            />
          ))}
          <NavButton
            item={{
              id: 'inbox',
              label: 'Inbox',
              icon: <Inbox className="h-4 w-4" />,
              badge: inboxCount > 0 ? inboxCount : undefined,
            }}
            active={currentArea === 'history' && currentView === 'inbox'}
            onClick={() => onViewChange('inbox', 'history')}
          />
        </NavSection>

        <NavSection
          title="ADMIN"
          active={currentArea === 'admin'}
          tone="warning"
          onSelect={() => onAreaChange('admin')}
        >
          {adminNavItems.map((item) => (
            <NavButton
              key={item.id}
              item={{
                ...item,
                badge:
                  item.id === 'drift' && driftScore !== undefined && driftScore > 0.1
                    ? Number((driftScore * 100).toFixed(0))
                    : item.badge,
              }}
              active={currentArea === 'admin' && currentView === item.id}
              onClick={() => onViewChange(item.id as AdminView, 'admin')}
            />
          ))}
        </NavSection>
      </nav>
    </aside>
  )
}

function NavSection({
  title,
  active,
  tone,
  onSelect,
  children,
}: {
  title: string
  active: boolean
  tone: 'accent' | 'warning'
  onSelect: () => void
  children: ReactNode
}) {
  return (
    <div className="mb-4">
      <button
        type="button"
        onClick={onSelect}
        className={cn(
          'mb-1 flex w-full items-center justify-between px-2 py-1.5 text-[10px] stamp-text',
          active
            ? tone === 'accent'
              ? 'text-accent'
              : 'text-warning'
            : 'text-muted hover:text-ink',
        )}
      >
        <span>{title}</span>
        {active && (
          <span className={cn('h-2 w-2 rounded-full', tone === 'accent' ? 'bg-success' : 'bg-warning')} />
        )}
      </button>
      {children}
    </div>
  )
}

function NavButton({
  item,
  active,
  onClick,
}: {
  item: NavItem
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2 px-2 py-2 text-sm transition-all',
        active ? 'bg-ink text-card shadow-hard' : 'text-text hover:bg-surface-hover',
      )}
    >
      {item.icon}
      <span>{item.label}</span>
      {item.badge !== undefined && item.badge > 0 && (
        <span className="ml-auto bg-warning px-1.5 py-0.5 text-[10px] stamp-text text-white">
          {item.id === 'drift' ? `${item.badge}%` : item.badge}
        </span>
      )}
    </button>
  )
}

function MobileNavButton({
  icon,
  label,
  active,
  badge,
  onClick,
}: {
  icon: ReactNode
  label: string
  active: boolean
  badge?: number
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'relative flex flex-col items-center justify-center gap-1 text-[10px] stamp-text transition-colors',
        active ? 'bg-ink text-card' : 'text-muted hover:text-ink',
      )}
    >
      {icon}
      <span>{label}</span>
      {badge !== undefined && badge > 0 && (
        <span className="absolute right-3 top-2 rounded-full bg-warning px-1.5 py-0.5 text-[9px] text-white">
          {label === 'Admin' ? `${badge}%` : badge}
        </span>
      )}
    </button>
  )
}
