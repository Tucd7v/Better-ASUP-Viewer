import React, { createContext, useContext, useReducer } from 'react'
import type { FileRecord, SessionMeta } from '../../types'

export type Action =
  | { type: 'HIDE_FILE'; fileId: string }
  | { type: 'SHOW_FILE'; fileId: string }
  | { type: 'TOGGLE_COLLAPSE'; fileId: string }
  | { type: 'SET_FILES'; files: FileRecord[]; sessionId: string; nodeColor: string }
  | { type: 'UPSERT_SESSION'; session: SessionMeta }
  | { type: 'UPDATE_NODE_POSITION'; nodeId: string; position: { x: number; y: number } }
  | { type: 'SET_GLOBAL_SEARCH'; fileId: string; query: string; line?: number }
  | { type: 'CLEAR_GLOBAL_SEARCH' }
  | { type: 'FOCUS_NODE'; hostname: string }
  | { type: 'CLEAR_FOCUS_NODE' }

interface ViewerState {
  sessions: SessionMeta[]
  fileList: FileRecord[]
  hiddenFileIds: Set<string>
  collapsedFileIds: Set<string>
  nodePositions: Map<string, { x: number; y: number }>
  globalSearch: { fileId: string; query: string; line?: number } | null
  focusNode: string | null
}

const initialState: ViewerState = {
  sessions: [],
  fileList: [],
  hiddenFileIds: new Set(),
  collapsedFileIds: new Set(),
  nodePositions: new Map(),
  globalSearch: null,
  focusNode: null,
}

function reducer(state: ViewerState, action: Action): ViewerState {
  switch (action.type) {
    case 'SET_FILES': {
      const existingIds = new Set(state.fileList.map((f) => f.id))
      const newFiles = action.files
        .filter((f) => !existingIds.has(f.id))
        .map((f) => ({ ...f, sessionId: action.sessionId, nodeColor: action.nodeColor }))
      const sessionExists = state.sessions.find((s) => s.sessionId === action.sessionId)
      const newSessions = sessionExists
        ? state.sessions
        : [
            ...state.sessions,
            {
              sessionId: action.sessionId,
              serialNum: '',
              generatedOn: '',
              nodeColor: action.nodeColor,
            },
          ]
      // All new cards start hidden — shown only when clicked in the sidebar
      const newHidden = new Set(state.hiddenFileIds)
      newFiles.forEach((f) => newHidden.add(f.id))
      return {
        ...state,
        sessions: newSessions,
        fileList: [...state.fileList, ...newFiles],
        hiddenFileIds: newHidden,
      }
    }
    case 'UPSERT_SESSION': {
      const sessionExists = state.sessions.some((s) => s.sessionId === action.session.sessionId)
      return {
        ...state,
        sessions: sessionExists
          ? state.sessions.map((s) =>
              s.sessionId === action.session.sessionId ? { ...s, ...action.session } : s
            )
          : [...state.sessions, action.session],
      }
    }
    case 'HIDE_FILE': {
      const next = new Set(state.hiddenFileIds)
      next.add(action.fileId)
      return { ...state, hiddenFileIds: next }
    }
    case 'SHOW_FILE': {
      const next = new Set(state.hiddenFileIds)
      next.delete(action.fileId)
      return { ...state, hiddenFileIds: next }
    }
    case 'TOGGLE_COLLAPSE': {
      const next = new Set(state.collapsedFileIds)
      if (next.has(action.fileId)) {
        next.delete(action.fileId)
      } else {
        next.add(action.fileId)
      }
      return { ...state, collapsedFileIds: next }
    }
    case 'UPDATE_NODE_POSITION': {
      const next = new Map(state.nodePositions)
      next.set(action.nodeId, action.position)
      return { ...state, nodePositions: next }
    }
    case 'SET_GLOBAL_SEARCH':
      return { ...state, globalSearch: { fileId: action.fileId, query: action.query, line: action.line } }
    case 'CLEAR_GLOBAL_SEARCH':
      return { ...state, globalSearch: null }
    case 'FOCUS_NODE':
      return { ...state, focusNode: action.hostname }
    case 'CLEAR_FOCUS_NODE':
      return { ...state, focusNode: null }
    default:
      return state
  }
}

interface ViewerContextValue {
  state: ViewerState
  dispatch: React.Dispatch<Action>
}

const ViewerContext = createContext<ViewerContextValue | null>(null)

export function ViewerProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState)
  return (
    <ViewerContext.Provider value={{ state, dispatch }}>
      {children}
    </ViewerContext.Provider>
  )
}

export function useViewer() {
  const ctx = useContext(ViewerContext)
  if (!ctx) throw new Error('useViewer must be used within ViewerProvider')
  return ctx
}
