import { useEffect, useState } from 'react'
import type { NodeProps, Node } from '@xyflow/react'
import { Handle, Position } from '@xyflow/react'
import { getFileContent } from '../../../services/api'
import type { EMSEvent } from '../../../types'
import { useResizable } from './useResizable'

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

export default function EMSFileCard({ data }: NodeProps<EMSFileNode>) {
  const { fileId, sessionId, filename, nodeColor, collapsed, onCollapse, onHide } = data
  const { width, height, onResizeX, onResizeY } = useResizable(320, 320)

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
    <div style={{ position: 'relative', width, minWidth: 220 }}>
      <Handle type="target" position={Position.Left} style={leftHandleStyle} />
      <Handle type="source" position={Position.Right} style={rightHandleStyle} />

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
        }}
      >
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
          <span>🚨</span>
          <span
            style={{
              flex: 1,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              color: '#334155',
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
            <div style={{ padding: '6px 10px', borderBottom: '1px solid #e2e8f0' }} className="nodrag">
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
              style={{ maxHeight: height, overflowY: 'auto' }}
              className="nodrag nowheel"
            >
              {loading ? (
                <div style={{ padding: '8px 10px', color: '#94a3b8' }}>Loading…</div>
              ) : filtered.length === 0 ? (
                <div style={{ padding: '8px 10px', color: '#94a3b8' }}>No events</div>
              ) : (
                filtered.map((ev, i) => (
                  <div
                    key={i}
                    style={{
                      padding: '6px 10px',
                      borderBottom: '1px solid #f1f5f9',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                      {ev.date && (
                        <span style={{ color: '#94a3b8', fontSize: 10 }}>{ev.date}</span>
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
                    </div>
                    {ev.summary && (
                      <div style={{ color: '#334155', marginBottom: 2 }}>{ev.summary}</div>
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

const handleStyle: React.CSSProperties = {
  width: 14,
  height: 14,
  background: '#ffffff',
  border: '2px solid #94a3b8',
  borderRadius: '50%',
  cursor: 'crosshair',
}

const leftHandleStyle: React.CSSProperties = {
  ...handleStyle,
  transform: 'translate(calc(-50% - 10px), -50%)',
}
const rightHandleStyle: React.CSSProperties = {
  ...handleStyle,
  transform: 'translate(calc(50% + 10px), -50%)',
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

const selectStyle: React.CSSProperties = {
  width: '100%',
  background: '#f8fafc',
  border: '1px solid #e2e8f0',
  borderRadius: 4,
  color: '#1e293b',
  padding: '3px 6px',
  fontSize: 11,
  fontFamily: 'ui-monospace, Consolas, monospace',
  outline: 'none',
}
