'use client'

import dynamic from 'next/dynamic'
import { useMemo, useState } from 'react'
import { AppShell } from '@/components/app-shell'
import type { AppArea, HistoryView, AdminView } from '@/lib/types'
import { useDriftQuery, useTurnsQuery } from '@/lib/api'

const AllTurnsView = dynamic(
  () => import('@/components/views/all-turns-view').then((module) => module.AllTurnsView),
  { loading: () => <ViewLoading label="Loading turns..." /> },
)
const ProjectsView = dynamic(
  () => import('@/components/views/projects-view').then((module) => module.ProjectsView),
  { loading: () => <ViewLoading label="Loading projects..." /> },
)
const InboxView = dynamic(
  () => import('@/components/views/inbox-view').then((module) => module.InboxView),
  { loading: () => <ViewLoading label="Loading inbox..." /> },
)
const SearchView = dynamic(
  () => import('@/components/views/search-view').then((module) => module.SearchView),
  { loading: () => <ViewLoading label="Loading search..." /> },
)
const SourcesView = dynamic(
  () => import('@/components/views/sources-view').then((module) => module.SourcesView),
  { loading: () => <ViewLoading label="Loading sources..." /> },
)
const LinkingView = dynamic(
  () => import('@/components/views/linking-view').then((module) => module.LinkingView),
  { loading: () => <ViewLoading label="Loading linking..." /> },
)
const MasksView = dynamic(
  () => import('@/components/views/masks-view').then((module) => module.MasksView),
  { loading: () => <ViewLoading label="Loading masks..." /> },
)
const DriftView = dynamic(
  () => import('@/components/views/drift-view').then((module) => module.DriftView),
  { loading: () => <ViewLoading label="Loading drift..." /> },
)

export default function Home() {
  const [area, setArea] = useState<AppArea>('history')
  const [historyView, setHistoryView] = useState<HistoryView>('all_turns')
  const [adminView, setAdminView] = useState<AdminView>('sources')
  const [lastHistoryView, setLastHistoryView] = useState<HistoryView>('all_turns')
  const { data: turns = [] } = useTurnsQuery()
  const { data: drift } = useDriftQuery()
  
  const currentView = area === 'history' ? historyView : adminView
  
  const handleViewChange = (view: HistoryView | AdminView, nextArea: AppArea) => {
    if (nextArea === 'history') {
      setHistoryView(view as HistoryView)
      if (view !== 'search' && view !== 'session_detail') {
        setLastHistoryView(view as HistoryView)
      }
    } else {
      setAdminView(view as AdminView)
    }
  }

  const handleOpenSearch = () => {
    setArea('history')
    if (historyView !== 'search' && historyView !== 'session_detail') {
      setLastHistoryView(historyView)
    }
    setHistoryView('search')
  }

  const handleCloseSearch = () => {
    setArea('history')
    setHistoryView(lastHistoryView === 'search' ? 'all_turns' : lastHistoryView)
  }
  
  // Calculate inbox count (unlinked + candidate turns)
  const inboxCount = useMemo(
    () => turns.filter((turn) => turn.link_state === 'unlinked' || turn.link_state === 'candidate').length,
    [turns],
  )
  
  // Render current view
  const renderView = () => {
    if (area === 'history') {
      switch (historyView) {
        case 'all_turns':
          return <AllTurnsView />
        case 'projects':
          return <ProjectsView />
        case 'inbox':
          return <InboxView />
        case 'search':
          return <SearchView onClose={handleCloseSearch} />
        case 'session_detail':
          return <AllTurnsView /> // Session detail is handled within AllTurnsView
        default:
          return <AllTurnsView />
      }
    } else {
      switch (adminView) {
        case 'sources':
          return <SourcesView />
        case 'linking':
          return <LinkingView />
        case 'masks':
          return <MasksView />
        case 'drift':
          return <DriftView />
        default:
          return <SourcesView />
      }
    }
  }
  
  return (
    <AppShell
      currentArea={area}
      currentView={currentView}
      onAreaChange={setArea}
      onViewChange={handleViewChange}
      onOpenSearch={handleOpenSearch}
      inboxCount={inboxCount}
      driftScore={drift?.global_drift_index}
    >
      {renderView()}
    </AppShell>
  )
}

function ViewLoading({ label }: { label: string }) {
  return (
    <div className="flex flex-1 items-center justify-center border-b border-border bg-paper px-6 text-sm text-muted">
      {label}
    </div>
  )
}
