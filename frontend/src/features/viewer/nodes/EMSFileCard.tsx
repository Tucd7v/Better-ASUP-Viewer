import { useEffect, useState } from 'react'
import type { NodeProps, Node } from '@xyflow/react'
import { Handle, Position } from '@xyflow/react'
import { getFileContent } from '../../../services/api'
import type { EMSEvent } from '../../../types'

export interface EMSFileCardData extends Record<string, unknown> {
  fileId: string
  sessionId: string
  filename: string
  nodeColor: string
  collapsed: boolean
  onCollapse: () => void
  onHide: () => void
}

export type EMSFileNode = Node<EMSFileCardData, 'emsFile'>

const ALL_LEVELS = ['emergency', 'alert', 'error', 'warning', 'notice', 'info', 'debug'] as const

function levelColor(level: string): string {
  switch (level) {
    case 'emergency':
    case 'alert':
    case 'error':
      return '#ef4444'
    case 'warning':
      return '#fbbf24'
    case 'notice':
    case 'info':
      return '#94a3b8'
    case 'debug':
      return '#6b7280'
    default:
      return '#94a3b8'
  }
}

export default function EMSFileCard({ data }: NodeProps<EMSFileNode>) {
  const { fileId, sessionId, filename, nodeColor, collapsed, onCollapse, onHide } = data

  const [events, setEvents] = useState<EMSEvent[]>([])
  const [levelFilter, setLevelFilter] = useState<string>('all')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (collapsed) return
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
      .finally(() => setLoading(false))
  }, [fileId, sessionId, collapsed])

  const filtered =
    levelFilter === 'all' ? events : events.filter((e) => e.level === levelFilter)

  return (
    <div
      style={{
        background: '#1e1e2e',
        border: '1px solid #2a2a3e',
        borderLeft: `3px solid ${nodeColor}`,
        borderRadius: 8,
        minWidth: 300,
        width: 320,
        fontFamily: 'ui-monospace, Consolas, monospace',
        fontSize: 12,
        color: '#e2e8f0',
        overflow: 'hidden',
      }}
    >
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '6px 10px',
          background: '#16162a',
          borderBottom: collapsed ? 'none' : '1px solid #2a2a3e',
        }}
      >
        <span>🚨</span>
        <span
          style={{
            flex: 1,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            color: '#cbd5e1',
          }}
          title={filename}
        >
          {filename}
        </span>
        <button onClick={onCollapse} style={btnStyle} title={collapsed ? 'Expand' : 'Collapse'}>
          {collapsed ? '[+]' : '[−]'}
        </button>
        <button onClick={onHide} style={btnStyle} title="Hide">
          [×]
        </button>
      </div>

      {!collapsed && (
        <div>
          <div style={{ padding: '6px 10px', borderBottom: '1px solid #2a2a3e' }} className="nodrag">
            <select
              value={levelFilter}
              onChange={(e) => setLevelFilter(e.target.value)}
              style={selectStyle}
            >
              <option value="all">All levels</option>
              {ALL_LEVELS.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </div>
          <div
            style={{ maxHeight: 320, overflowY: 'auto' }}
            className="nodrag nowheel"
          >
            {loading ? (
              <div style={{ padding: '8px 10px', color: '#64748b' }}>Loading…</div>
            ) : filtered.length === 0 ? (
              <div style={{ padding: '8px 10px', color: '#64748b' }}>No events</div>
            ) : (
              filtered.map((ev, i) => (
                <div
                  key={i}
                  style={{
                    padding: '6px 10px',
                    borderBottom: '1px solid #1a1a2e',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                    {ev.date && (
                      <span style={{ color: '#475569', fontSize: 10 }}>{ev.date}</span>
                    )}
                    <span
                      style={{
                        background: `${levelColor(ev.level)}22`,
                        color: levelColor(ev.level),
                        border: `1px solid ${levelColor(ev.level)}55`,
                        borderRadius: 3,
                        padding: '0 4px',
                        fontSize: 10,
                        textTransform: 'uppercase',
                        letterSpacing: 0.5,
                      }}
                    >
                      {ev.level}
                    </span>
                  </div>
                  {ev.summary && (
                    <div style={{ color: '#cbd5e1', marginBottom: 2 }}>{ev.summary}</div>
                  )}
                  {ev.content && ev.content !== ev.summary && (
                    <div style={{ color: '#64748b', fontSize: 10, wordBreak: 'break-word' }}>
                      {ev.content}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}

      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
    </div>
  )
}

const btnStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: '#64748b',
  cursor: 'pointer',
  padding: '0 2px',
  fontSize: 11,
  fontFamily: 'ui-monospace, Consolas, monospace',
}

const selectStyle: React.CSSProperties = {
  width: '100%',
  background: '#0f0f1a',
  border: '1px solid #2a2a3e',
  borderRadius: 4,
  color: '#e2e8f0',
  padding: '3px 6px',
  fontSize: 11,
  fontFamily: 'ui-monospace, Consolas, monospace',
  outline: 'none',
}
