'use client'

import { useSearchParams, useRouter, usePathname } from 'next/navigation'
import { useCallback, useEffect, useRef } from 'react'
import type { AppArea, HistoryView, AdminView } from './types'

const HISTORY_VIEWS = new Set<string>(['all_turns', 'projects', 'inbox', 'search', 'session_detail'])
const ADMIN_VIEWS = new Set<string>(['sources', 'linking', 'masks', 'drift'])

function parseArea(value: string | null): AppArea {
  return value === 'admin' ? 'admin' : 'history'
}

function parseView(value: string | null, area: AppArea): HistoryView | AdminView {
  if (area === 'history') {
    return HISTORY_VIEWS.has(value ?? '') ? (value as HistoryView) : 'all_turns'
  }
  return ADMIN_VIEWS.has(value ?? '') ? (value as AdminView) : 'sources'
}

export function useViewRouter() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()

  const area = parseArea(searchParams.get('area'))
  const currentView = parseView(searchParams.get('view'), area)

  // Track the "last non-search history view" for search close behavior.
  // We use a ref so it persists across renders without causing re-renders.
  const lastHistoryViewRef = useRef<HistoryView>('all_turns')
  useEffect(() => {
    if (area === 'history' && currentView !== 'search' && currentView !== 'session_detail') {
      lastHistoryViewRef.current = currentView as HistoryView
    }
  }, [area, currentView])

  const navigate = useCallback(
    (nextArea: AppArea, nextView: string) => {
      const params = new URLSearchParams()
      // Only set params when they differ from defaults to keep URLs clean
      if (nextArea !== 'history') {
        params.set('area', nextArea)
      }
      const defaultView = nextArea === 'history' ? 'all_turns' : 'sources'
      if (nextView !== defaultView) {
        params.set('view', nextView)
      }
      const qs = params.toString()
      router.push(qs ? `${pathname}?${qs}` : pathname)
    },
    [router, pathname],
  )

  const setArea = useCallback(
    (nextArea: AppArea) => {
      const defaultView = nextArea === 'history' ? 'all_turns' : 'sources'
      navigate(nextArea, defaultView)
    },
    [navigate],
  )

  const handleViewChange = useCallback(
    (view: HistoryView | AdminView, nextArea: AppArea) => {
      navigate(nextArea, view)
    },
    [navigate],
  )

  const handleOpenSearch = useCallback(() => {
    navigate('history', 'search')
  }, [navigate])

  const handleCloseSearch = useCallback(() => {
    const fallback = lastHistoryViewRef.current === 'search' ? 'all_turns' : lastHistoryViewRef.current
    navigate('history', fallback)
  }, [navigate])

  return {
    area,
    currentView,
    historyView: area === 'history' ? (currentView as HistoryView) : 'all_turns',
    adminView: area === 'admin' ? (currentView as AdminView) : 'sources',
    setArea,
    handleViewChange,
    handleOpenSearch,
    handleCloseSearch,
  }
}
