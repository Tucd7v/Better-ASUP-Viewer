import { useEffect, useRef, useState } from 'react'
import type { NodeProps, Node } from '@xyflow/react'
import { getFileContent } from '../../../services/api'
import type { EMSEvent } from '../../../types'
import { useResizable } from './useResizable'
import { useViewer } from '../ViewerContext'
import { setGridDragActive } from './gridDragState'

export interface EMSFileCardData extends Record<string, unknown> {
  fileId: string
  sessionId: string
  filename: string
  aiSummary?: string
  nodeColor: string
  collapsed: boolean
  splitMode?: boolean
  onGridDragStart?: () => void
  onGridDragEnd?: () => void
  onCollapse: () => void
  onHide: () => void
  onDuplicate: () => void
  onReadyForViewport?: (nodeId: string, size?: { width?: number; height?: number }) => void
}

export type EMSFileNode = Node<EMSFileCardData, 'emsFile'>

function GridDragGrip({ onDragStart, onDragEnd }: {
  onDragStart: () => void
  onDragEnd?: () => void
}) {
  return (
    <span
      draggable
      className="nodrag"
      onDragStart={(event) => {
        event.stopPropagation()
        event.dataTransfer.effectAllowed = 'move'
        event.dataTransfer.setData('card-drag', 'true')
        setGridDragActive(true)
        onDragStart()
      }}
      onDragEnd={(event) => {
        event.stopPropagation()
        setGridDragActive(false)
        onDragEnd?.()
      }}
      style={gridDragGripStyle}
      title="Drag to reorder"
    >
      ⋮⋮
    </span>
  )
}

const ALL_LEVELS = ['emergency', 'alert', 'error', 'warning', 'notice', 'info', 'debug'] as const

function levelColor(level: string): string {
  switch (level) {
    case 'emergency':
    case 'alert':
    case 'error':
      return '#dc2626'
    case 'warning':
      return '#d97706'
    case 'notice':
    case 'info':
      return '#2563eb'
    case 'debug':
      return '#6b7280'
    default:
      return '#64748b'
  }
}

function highlight(text: string, query: string): React.ReactNode {
  if (!query) return text
  const parts = text.split(new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'))
  return parts.map((part, i) =>
    part.toLowerCase() === query.toLowerCase()
      ? <mark key={i} style={{ background: '#fef08a', color: '#1e293b', borderRadius: 2, padding: '0 1px' }}>{part}</mark>
      : part
  )
}

export default function EMSFileCard({ data }: NodeProps<EMSFileNode>) {
  const { fileId, sessionId, filename, aiSummary: dataAiSummary, nodeColor, collapsed, splitMode, onGridDragStart, onGridDragEnd, onCollapse, onHide, onDuplicate, onReadyForViewport } = data
  const { width, height, onResizeX, onResizeY } = useResizable(800, 400)

  const [events, setEvents] = useState<EMSEvent[]>([])
  const [levelFilter, setLevelFilter] = useState<string>('all')
  const [search, setSearch] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [contentReady, setContentReady] = useState(false)
  const [highlightLine, setHighlightLine] = useState<number | null>(null)
  const eventRefs = useRef<(HTMLDivElement | null)[]>([])
  const viewportReadyReported = useRef(false)
  const { state, dispatch: viewDispatch } = useViewer()
  const sessionMeta = state.sessions.find((session) => session.sessionId === sessionId)
  const hostname = sessionMeta?.hostname?.trim() ?? ''
  const aiSummary = (dataAiSummary || sessionMeta?.aiSummary || sessionMeta?.ai_summary || '').trim()
  const fontSize = state.fontSize || 13

  useEffect(() => {
    if (collapsed) {
      setContentReady(true)
      return
    }
    setContentReady(false)
    setLoading(true)
    getFileContent(sessionId, fileId)
      .then((res) => {
        const d = res.data
        if (Array.isArray(d.events)) {
          setEvents(d.events)
        } else if (Array.isArray(d.lines)) {
          setEvents(
            d.lines.map((l: string) => ({
              date: '',
              hostname: '',
              level: 'info',
              operation: '',
              summary: l,
              content: l,
            }))
          )
        }
      })
      .catch(() => setEvents([]))
      .finally(() => {
        setLoading(false)
        setContentReady(true)
      })
  }, [fileId, sessionId, collapsed])

  useEffect(() => {
    viewportReadyReported.current = false
  }, [fileId])

  useEffect(() => {
    if (splitMode || !contentReady || viewportReadyReported.current) return
    viewportReadyReported.current = true
    onReadyForViewport?.(fileId, { width })
  }, [contentReady, fileId, onReadyForViewport, splitMode, width])

  // Respond to global search
  useEffect(() => {
    const gs = state.globalSearch
    if (gs && gs.fileId === fileId) {
      if (gs.query) setSearch(gs.query)
      if (gs.line !== undefined) {
        const targetIdx = gs.line - 1
        setLevelFilter('all')
        setHighlightLine(targetIdx)
        setTimeout(() => {
          const el = eventRefs.current[targetIdx]
          if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' })
        }, 300)
      }
      viewDispatch({ type: 'CLEAR_GLOBAL_SEARCH' })
    }
  }, [state.globalSearch])

  const filtered = events
    .filter((e) => levelFilter === 'all' || e.level === levelFilter)
    .filter((e) => {
      if (!search) return true
      const q = search.toLowerCase()
      return (
        e.content.toLowerCase().includes(q) ||
        e.date.toLowerCase().includes(q) ||
        e.hostname.toLowerCase().includes(q) ||
        e.level.toLowerCase().includes(q)
      )
    })

  return (
    <div style={{ position: 'relative', width: splitMode ? '100%' : width, minWidth: splitMode ? undefined : 320, height: splitMode ? '100%' : undefined }}>
      <div
        style={{
          background: '#ffffff',
          border: '1px solid #e2e8f0',
          borderLeft: `3px solid ${nodeColor}`,
          borderRadius: 8,
          fontFamily: 'ui-monospace, Consolas, monospace',
          fontSize: 12,
          color: '#1e293b',
          overflow: 'hidden',
          height: splitMode ? '100%' : undefined,
          display: splitMode ? 'flex' : undefined,
          flexDirection: splitMode ? 'column' : undefined,
        }}
      >
        {/* title bar */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '6px 10px',
            background: '#f8fafc',
            borderBottom: collapsed ? 'none' : '1px solid #e2e8f0',
          }}
        >
          {splitMode && onGridDragStart && <GridDragGrip onDragStart={onGridDragStart} onDragEnd={onGridDragEnd} />}
          <span>🚨</span>
          <div style={headerTitleStyle}>
            <span style={filenameStyle} title={filename}>
              {filename}
            </span>
            {aiSummary && (
              <span style={aiSummaryBadgeStyle} title={aiSummary} aria-label="AI health summary">
                💡
              </span>
            )}
            {hostname && (
              <>
                <span aria-hidden="true" style={headerDividerStyle} />
                <button
                  type="button"
                  className="nodrag card-hostname-button"
                  style={hostnameStyle}
                  title={hostname}
                  onClick={(e) => {
                    e.stopPropagation()
                    viewDispatch({ type: 'FOCUS_NODE', hostname })
                  }}
                >
                  {hostname}
                </button>
              </>
            )}
          </div>
          {(data as any).__duplicate ? null : (
          <button
            type="button"
            className="nodrag"
            onClick={(e) => { e.stopPropagation(); onDuplicate() }}
            style={btnStyle}
            title="Duplicate"
          >
            [⧉]
          </button>
          )}
          <button type="button" className="nodrag" onClick={onCollapse} style={btnStyle} title={collapsed ? 'Expand' : 'Collapse'}>
            {collapsed ? '[+]' : '[−]'}
          </button>
          <button type="button" className="nodrag" onClick={onHide} style={btnStyle} title="Hide">
            [×]
          </button>
        </div>

        {!collapsed && (
          <div style={{ display: splitMode ? 'flex' : undefined, flexDirection: splitMode ? 'column' : undefined, flex: splitMode ? 1 : undefined, minHeight: splitMode ? 0 : undefined }}>
            {/* filter bar */}
            <div
              style={{ display: 'flex', gap: 6, padding: '6px 10px', borderBottom: '1px solid #e2e8f0' }}
              className="nodrag"
            >
              <select
                value={levelFilter}
                onChange={(e) => setLevelFilter(e.target.value)}
                style={{ ...selectStyle, width: 110, flexShrink: 0 }}
              >
                <option value="all">All levels</option>
                {ALL_LEVELS.map((l) => (
                  <option key={l} value={l}>{l}</option>
                ))}
              </select>
              <input
                type="text"
                placeholder="Search…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="nodrag"
                style={searchStyle}
              />
              {search && (
                <button onClick={() => setSearch('')} style={btnStyle} title="Clear">
                  [×]
                </button>
              )}
            </div>

            {/* match count */}
            {!loading && (search || levelFilter !== 'all') && (
              <div style={{ padding: '3px 10px', fontSize: 10, color: '#94a3b8', borderBottom: '1px solid #f1f5f9' }}>
                {filtered.length} / {events.length} events
              </div>
            )}

            {/* nowheel intercepts scroll; nodrag + userSelect allow text selection */}
            <div
              style={{ height: splitMode ? undefined : height, overflowY: 'auto', flex: splitMode ? 1 : undefined, minHeight: splitMode ? 0 : undefined, userSelect: 'text', cursor: 'text' }}
              className="nodrag nowheel"
            >
              {loading ? (
                <div style={{ padding: '8px 10px', color: '#94a3b8' }}>Loading…</div>
              ) : filtered.length === 0 ? (
                <div style={{ padding: '8px 10px', color: '#94a3b8' }}>No events</div>
              ) : (
                filtered.map((ev, i) => {
                  const origIdx = events.indexOf(ev)
                  const isHighlight = highlightLine === origIdx
                  return (
                  <div
                    key={i}
                    ref={(el) => { if (origIdx >= 0) eventRefs.current[origIdx] = el }}
                    style={{
                      padding: '6px 10px',
                      borderBottom: '1px solid #f1f5f9',
                      background: isHighlight ? 'rgba(251,191,36,0.2)' : 'transparent',
                      fontSize,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                      {ev.date && (
                        <span style={{ color: '#94a3b8', fontSize: 10 }}>
                          {highlight(ev.date, search)}
                        </span>
                      )}
                      <span
                        style={{
                          background: `${levelColor(ev.level)}18`,
                          color: levelColor(ev.level),
                          border: `1px solid ${levelColor(ev.level)}44`,
                          borderRadius: 3,
                          padding: '0 4px',
                          fontSize: 10,
                          textTransform: 'uppercase',
                          letterSpacing: 0.5,
                        }}
                      >
                        {ev.level}
                      </span>
                      {ev.hostname && (
                        <span style={{ color: '#94a3b8', fontSize: 10 }}>
                          {highlight(ev.hostname, search)}
                        </span>
                      )}
                    </div>
                    {ev.content && (
                      <div style={{ color: '#64748b', fontSize: 11, wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}>
                        {highlight(ev.content, search)}
                      </div>
                    )}
                  </div>
                  )
                })
              )}
            </div>

            <div
              onMouseDown={onResizeY}
              className="nodrag"
              style={{ height: 6, cursor: 'ns-resize', background: '#e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >
              <div style={{ width: 30, height: 2, borderRadius: 1, background: '#94a3b8' }} />
            </div>
          </div>
        )}
      </div>

      <div
        onMouseDown={onResizeX}
        className="nodrag"
        style={{ position: 'absolute', top: 0, right: -4, width: 8, height: '100%', cursor: 'ew-resize', zIndex: 10 }}
      />
    </div>
  )
}

const btnStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: '#94a3b8',
  cursor: 'pointer',
  padding: '0 2px',
  fontSize: 11,
  fontFamily: 'ui-monospace, Consolas, monospace',
}

const gridDragGripStyle: React.CSSProperties = {
  color: '#94a3b8',
  cursor: 'grab',
  fontSize: 12,
  lineHeight: 1,
  userSelect: 'none',
  flexShrink: 0,
}

const headerTitleStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  flex: 1,
  minWidth: 0,
}

const filenameStyle: React.CSSProperties = {
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  color: '#334155',
  flexShrink: 1,
};

const aiSummaryBadgeStyle: React.CSSProperties = {
  flexShrink: 0,
  cursor: 'help',
  fontSize: 13,
  lineHeight: '16px',
}

const headerDividerStyle: React.CSSProperties = {
  width: 1,
  height: 12,
  background: '#e2e8f0',
  flexShrink: 0,
}

const hostnameStyle: React.CSSProperties = {
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  color: '#94a3b8',
  fontSize: 11,
  flexShrink: 1,
  lineHeight: '16px',
  marginTop: 2,
  background: 'none',
  border: 0,
  padding: 0,
  cursor: 'pointer',
  fontFamily: 'ui-monospace, Consolas, monospace',
};

const selectStyle: React.CSSProperties = {
  background: '#f8fafc',
  border: '1px solid #e2e8f0',
  borderRadius: 4,
  color: '#1e293b',
  padding: '3px 6px',
  fontSize: 11,
  fontFamily: 'ui-monospace, Consolas, monospace',
  outline: 'none',
}

const searchStyle: React.CSSProperties = {
  flex: 1,
  background: '#f8fafc',
  border: '1px solid #e2e8f0',
  borderRadius: 4,
  color: '#1e293b',
  padding: '3px 6px',
  fontSize: 11,
  fontFamily: 'ui-monospace, Consolas, monospace',
  outline: 'none',
}
