import type { ReactNode } from 'react'
import type { ProjectIdentity, Session, TokenUsageSummary, UserTurn } from '@/lib/types'

export interface SessionMapProps {
  turns: UserTurn[]
  sessionRegistry: Map<string, Session>
  projectRegistry: Map<string, ProjectIdentity>
  selectedTurnId?: string
  onTurnSelect: (turn: UserTurn) => void
  className?: string
  defaultAxisMode?: AxisMode
  fixedAxisMode?: AxisMode
  defaultSortBy?: SessionMapSort
  defaultSortDirection?: SessionMapSortDirection
  showOverview?: boolean
  hideProjectPathWhenRedundant?: boolean
}

export interface SessionGroup {
  key: string
  project?: ProjectIdentity
  lanes: SessionLane[]
  turns: UserTurn[]
  projectStartedAt: Date
  projectClosedAt: Date
  activeStartedAt: Date
  activeEndedAt: Date
  activeDurationMs: number
  tokenUsage?: TokenUsageSummary
  trackedTokenTurnCount: number
  excludedKnownZeroToken?: number
}

export interface SessionLane {
  session: Session
  turns: UserTurn[]
  turnWindows: TurnWindow[]
  project?: ProjectIdentity
  sessionStartedAt: Date
  sessionClosedAt: Date
  activeStartedAt: Date
  activeEndedAt: Date
  activeDurationMs: number
  tokenUsage?: TokenUsageSummary
  trackedTokenTurnCount: number
  excludedKnownZeroToken?: number
}

export interface TurnWindow {
  turn: UserTurn
  order: number
  startMs: number
  endMs: number
}

export interface RenderSegment {
  turn: UserTurn
  order: number
  left: number
  width: number
  row: number
}

export type AxisMode = 'shared' | 'session'
export type LaneDensity = 'single' | 'standard' | 'dense'
export type SessionMapSort = 'recent' | 'created' | 'turns' | 'active' | 'span' | 'tokens' | 'name'
export type SessionMapSortDirection = 'asc' | 'desc'
