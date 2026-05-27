import { useEffect, useState } from 'react'
import type { NodeProps, Node } from '@xyflow/react'
import { Handle, Position } from '@xyflow/react'
import { getFileContent } from '../../../services/api'

export interface TextFileCardData extends Record<string, unknown> {
  fileId: string
  sessionId: string
  filename: string
  nodeColor: string
  collapsed: boolean
  onCollapse: () => void
  onHide: () => void
}

export type TextFileNode = Node<TextFileCardData, 'textFile'>

export default function TextFileCard({ data }: NodeProps<TextFileNode>) {
  const { fileId, sessionId, filename, nodeColor, collapsed, onCollapse, onHide } = data

  const [lines, setLines] = useState<string[]>([])
  const [totalLines, setTotalLines] = useState(0)
  const [page, setPage] = useState(0)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const LIMIT = 500

  useEffect(() => {
    if (collapsed) return
    setLoading(true)
    getFileContent(sessionId, fileId, page * LIMIT, LIMIT)
      .then((res) => {
        const d = res.data
        if (Array.isArray(d.lines)) {
          setLines(d.lines)
          setTotalLines(d.total ?? d.lines.length)
        } else if (typeof d.content === 'string') {
          const ls = d.content.split('\n')
          setLines(ls)
          setTotalLines(ls.length)
        }
      })
      .catch(() => setLines([]))
      .finally(() => setLoading(false))
  }, [fileId, sessionId, page, collapsed])

  const filtered = search
    ? lines.filter((l) => l.toLowerCase().includes(search.toLowerCase()))
    : lines

  const totalPages = Math.max(1, Math.ceil(totalLines / LIMIT))

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
          cursor: 'default',
        }}
      >
        <span>📄</span>
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
        <button
          onClick={onCollapse}
          style={btnStyle}
          title={collapsed ? 'Expand' : 'Collapse'}
        >
          {collapsed ? '[+]' : '[−]'}
        </button>
        <button onClick={onHide} style={btnStyle} title="Hide">
          [×]
        </button>
      </div>

      {!collapsed && (
        <div>
          <div style={{ padding: '6px 10px', borderBottom: '1px solid #2a2a3e' }}>
            <input
              type="text"
              placeholder="Search..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={inputStyle}
              className="nodrag"
            />
          </div>
          <div
            style={{
              height: 320,
              overflowY: 'auto',
              padding: '4px 0',
            }}
            className="nodrag nowheel"
          >
            {loading ? (
              <div style={{ padding: '8px 10px', color: '#64748b' }}>Loading…</div>
            ) : (
              filtered.map((line, i) => (
                <div
                  key={i}
                  style={{ display: 'flex', gap: 8, padding: '1px 10px' }}
                >
                  <span style={{ color: '#475569', minWidth: 36, textAlign: 'right', userSelect: 'none' }}>
                    {page * LIMIT + i + 1}
                  </span>
                  <span style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{line}</span>
                </div>
              ))
            )}
          </div>
          {totalPages > 1 && !search && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '6px 10px',
                borderTop: '1px solid #2a2a3e',
                color: '#64748b',
              }}
              className="nodrag"
            >
              <button
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                style={navBtnStyle}
              >
                ← Prev
              </button>
              <span>
                {page + 1} / {totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
                style={navBtnStyle}
              >
                Next →
              </button>
            </div>
          )}
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

const inputStyle: React.CSSProperties = {
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

const navBtnStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: '#94a3b8',
  cursor: 'pointer',
  fontSize: 11,
  padding: '2px 4px',
  fontFamily: 'ui-monospace, Consolas, monospace',
}
