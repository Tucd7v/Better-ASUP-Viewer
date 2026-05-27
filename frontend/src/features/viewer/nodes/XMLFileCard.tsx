import { useEffect, useState } from 'react'
import type { NodeProps, Node } from '@xyflow/react'
import { Handle, Position } from '@xyflow/react'
import { getFileContent } from '../../../services/api'

export interface XMLFileCardData extends Record<string, unknown> {
  fileId: string
  sessionId: string
  filename: string
  nodeColor: string
  collapsed: boolean
  onCollapse: () => void
  onHide: () => void
}

export type XMLFileNode = Node<XMLFileCardData, 'xmlFile'>

interface TableRow {
  [key: string]: string
}

type SortDir = 'asc' | 'desc'

export default function XMLFileCard({ data }: NodeProps<XMLFileNode>) {
  const { fileId, sessionId, filename, nodeColor, collapsed, onCollapse, onHide } = data

  const [rows, setRows] = useState<TableRow[]>([])
  const [columns, setColumns] = useState<string[]>([])
  const [sortCol, setSortCol] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (collapsed) return
    setLoading(true)
    getFileContent(sessionId, fileId)
      .then((res) => {
        const d = res.data
        if (Array.isArray(d.rows) && d.rows.length > 0) {
          setColumns(Object.keys(d.rows[0]))
          setRows(d.rows)
        } else if (Array.isArray(d.lines)) {
          const ls: string[] = d.lines
          if (ls.length > 0) {
            const cols = ls[0].split('\t')
            setColumns(cols)
            setRows(
              ls.slice(1).map((l) => {
                const vals = l.split('\t')
                return Object.fromEntries(cols.map((c, i) => [c, vals[i] ?? '']))
              })
            )
          }
        }
      })
      .catch(() => setRows([]))
      .finally(() => setLoading(false))
  }, [fileId, sessionId, collapsed])

  const handleSort = (col: string) => {
    if (sortCol === col) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortCol(col)
      setSortDir('asc')
    }
  }

  const sorted = sortCol
    ? [...rows].sort((a, b) => {
        const av = a[sortCol] ?? ''
        const bv = b[sortCol] ?? ''
        return sortDir === 'asc'
          ? av.localeCompare(bv, undefined, { numeric: true })
          : bv.localeCompare(av, undefined, { numeric: true })
      })
    : rows

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
        <span>📊</span>
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
        <div
          style={{ maxHeight: 360, overflowX: 'auto', overflowY: 'auto' }}
          className="nodrag nowheel"
        >
          {loading ? (
            <div style={{ padding: '8px 10px', color: '#64748b' }}>Loading…</div>
          ) : rows.length === 0 ? (
            <div style={{ padding: '8px 10px', color: '#64748b' }}>No data</div>
          ) : (
            <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 11 }}>
              <thead>
                <tr>
                  {columns.map((col) => (
                    <th
                      key={col}
                      onClick={() => handleSort(col)}
                      style={{
                        padding: '4px 8px',
                        textAlign: 'left',
                        background: '#16162a',
                        borderBottom: '1px solid #2a2a3e',
                        cursor: 'pointer',
                        whiteSpace: 'nowrap',
                        color: sortCol === col ? '#93c5fd' : '#94a3b8',
                        userSelect: 'none',
                      }}
                    >
                      {col}
                      {sortCol === col ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sorted.map((row, i) => (
                  <tr key={i} style={{ background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)' }}>
                    {columns.map((col) => (
                      <td
                        key={col}
                        style={{
                          padding: '3px 8px',
                          borderBottom: '1px solid #1a1a2e',
                          whiteSpace: 'nowrap',
                          maxWidth: 160,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                        title={row[col]}
                      >
                        {row[col]}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
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
