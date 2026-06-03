import { useEffect, useRef, useState } from 'react'
import type { NodeProps, Node } from '@xyflow/react'
import { getFileContent } from '../../../services/api'
import { useResizable } from './useResizable'
import { useViewer } from '../ViewerContext'

export interface XMLFileCardData extends Record<string, unknown> {
  fileId: string
  sessionId: string
  filename: string
  nodeColor: string
  collapsed: boolean
  splitMode?: boolean
  onCollapse: () => void
  onHide: () => void
}

export type XMLFileNode = Node<XMLFileCardData, 'xmlFile'>

interface TableRow { [key: string]: string }
type SortDir = 'asc' | 'desc' | null

export default function XMLFileCard({ data }: NodeProps<XMLFileNode>) {
  const { fileId, sessionId, filename, nodeColor, collapsed, splitMode, onCollapse, onHide } = data
  const { width, height, setWidth, onResizeX, onResizeY } = useResizable(320, 360)

  const [rows, setRows] = useState<TableRow[]>([])
  const [columns, setColumns] = useState<string[]>([])
  const [sortCol, setSortCol] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<SortDir>(null)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [tableWidth, setTableWidth] = useState(0)
  const [pinnedCols, setPinnedCols] = useState<Set<string>>(new Set())

  const dragCol = useRef<string | null>(null)
  const dragOverCol = useRef<string | null>(null)
  const [dragTarget, setDragTarget] = useState<string | null>(null)

  const rowRefs = useRef<(HTMLTableRowElement | null)[]>([])
  const [highlightRow, setHighlightRow] = useState<number | null>(null)
  const { state, dispatch: viewDispatch } = useViewer()
  const hostname = state.sessions.find((session) => session.sessionId === sessionId)?.hostname?.trim() ?? ''

  useEffect(() => {
    if (collapsed) return
    setLoading(true)
    getFileContent(sessionId, fileId)
      .then((res) => {
        const d = res.data
        if (Array.isArray(d.rows) && d.rows.length > 0) {
          const cols = Object.keys(d.rows[0])
          setColumns(cols)
          setRows(d.rows)
          const colW = cols.reduce((sum, c) => sum + Math.max(100, c.length * 9), 0)
          setTableWidth(colW)
          setWidth(Math.max(320, Math.min(1000, colW + 20)))
        } else if (Array.isArray(d.lines)) {
          const ls: string[] = d.lines
          if (ls.length > 0) {
            const cols = ls[0].split('\t')
            setColumns(cols)
            const rowData = ls.slice(1).map((l) => {
              const vals = l.split('\t')
              return Object.fromEntries(cols.map((c, i) => [c, vals[i] ?? '']))
            })
            setRows(rowData)
            const colW = cols.reduce((sum, c) => sum + Math.max(100, c.length * 9), 0)
            setTableWidth(colW)
            setWidth(Math.max(320, Math.min(1000, colW + 20)))
          }
        }
      })
      .catch(() => setRows([]))
      .finally(() => setLoading(false))
  }, [fileId, sessionId, collapsed])

  // Respond to global search
  useEffect(() => {
    const gs = state.globalSearch
    if (gs && gs.fileId === fileId) {
      if (gs.query) setSearch(gs.query)
      if (gs.line !== undefined) {
        // Treat line as 1-based row index in the original (pre-sort, pre-filter) list
        const targetIdx = gs.line - 1
        setHighlightRow(targetIdx)
        // Clear sort so the row index is meaningful
        setSortCol(null)
        setSortDir(null)
        if (gs.query === undefined || gs.query === '') setSearch('')
        setTimeout(() => {
          const el = rowRefs.current[targetIdx]
          if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' })
        }, 300)
      }
      viewDispatch({ type: 'CLEAR_GLOBAL_SEARCH' })
    }
  }, [state.globalSearch])

  // Three-state sort: asc → desc → null
  const handleSort = (col: string) => {
    if (sortCol !== col) {
      setSortCol(col)
      setSortDir('asc')
    } else if (sortDir === 'asc') {
      setSortDir('desc')
    } else if (sortDir === 'desc') {
      setSortCol(null)
      setSortDir(null)
    }
  }

  const sorted = sortCol && sortDir
    ? [...rows].sort((a, b) => {
        const av = a[sortCol] ?? '', bv = b[sortCol] ?? ''
        return sortDir === 'asc'
          ? av.localeCompare(bv, undefined, { numeric: true })
          : bv.localeCompare(av, undefined, { numeric: true })
      })
    : rows

  const onDragStart = (col: string) => { dragCol.current = col }
  const onDragEnter = (col: string) => { dragOverCol.current = col; setDragTarget(col) }
  const onDragEnd = () => {
    const from = dragCol.current
    const to = dragOverCol.current
    if (from && to && from !== to) {
      setColumns((cols) => {
        const next = [...cols]
        const fi = next.indexOf(from)
        const ti = next.indexOf(to)
        next.splice(fi, 1)
        next.splice(ti, 0, from)
        return next
      })
    }
    dragCol.current = null
    dragOverCol.current = null
    setDragTarget(null)
  }

  const togglePinnedCol = (col: string) => {
    setPinnedCols((prev) => {
      const next = new Set(prev)
      if (next.has(col)) next.delete(col)
      else next.add(col)
      return next
    })
  }

  const needsScroll = tableWidth > 0 && tableWidth > width - 20

  const getColumnWidth = (col: string) => Math.max(100, col.length * 9)

  const getPinnedLeft = (col: string) => {
    let left = 0
    for (const current of columns) {
      if (current === col) return left
      if (pinnedCols.has(current)) left += getColumnWidth(current)
    }
    return left
  }

  const sortIndicator = (col: string) => {
    if (sortCol !== col || !sortDir) return ''
    return sortDir === 'asc' ? ' ↑' : ' ↓'
  }

  return (
    <div style={{ position: 'relative', width: splitMode ? '100%' : width, height: splitMode ? '100%' : undefined }}>
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', background: '#f8fafc', borderBottom: collapsed ? 'none' : '1px solid #e2e8f0', borderRadius: collapsed ? 8 : '8px 8px 0 0' }}>
          <span>📊</span>
          <div style={headerTitleStyle}>
            <span style={filenameStyle} title={filename}>
              {filename}
            </span>
            {hostname && (
              <>
                <span aria-hidden="true" style={headerDividerStyle} />
                <span style={hostnameStyle} title={hostname}>
                  {hostname}
                </span>
              </>
            )}
          </div>
          <button onClick={onCollapse} style={btnStyle} title={collapsed ? 'Expand' : 'Collapse'}>
            {collapsed ? '[+]' : '[−]'}
          </button>
          <button onClick={onHide} style={btnStyle} title="Hide">[×]</button>
        </div>

        {!collapsed && (
          <div style={{ display: splitMode ? 'flex' : undefined, flexDirection: splitMode ? 'column' : undefined, flex: splitMode ? 1 : undefined, minHeight: splitMode ? 0 : undefined }}>
            <div style={{ padding: '6px 10px', borderBottom: '1px solid #e2e8f0', display: 'flex', gap: 4 }} className="nodrag">
              <input
                type="text"
                placeholder="Search…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{
                  width: '100%', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 4,
                  color: '#1e293b', padding: '3px 6px', fontSize: 11,
                  fontFamily: 'ui-monospace, Consolas, monospace', outline: 'none',
                }}
                className="nodrag"
              />
            </div>
            <div
              style={{
                height: splitMode ? undefined : height,
                overflowX: needsScroll ? 'scroll' : 'hidden',
                overflowY: 'auto',
                flex: splitMode ? 1 : undefined,
                minHeight: splitMode ? 0 : undefined,
                borderRadius: '0 0 8px 8px',
                userSelect: 'text',
                cursor: 'text',
              }}
              className="nodrag nowheel"
              onPointerDown={(e) => e.stopPropagation()}
            >
              {loading ? (
                <div style={{ padding: '8px 10px', color: '#94a3b8' }}>Loading…</div>
              ) : rows.length === 0 ? (
                <div style={{ padding: '8px 10px', color: '#94a3b8' }}>No data</div>
              ) : (
                <table style={{ borderCollapse: 'collapse', fontSize: 11, tableLayout: 'auto' }}>
                  <thead>
                    <tr>
                      {columns.map((col) => {
                        const isPinned = pinnedCols.has(col)
                        const pinnedLeft = getPinnedLeft(col)
                        const columnWidth = getColumnWidth(col)

                        return (
                          <th
                            key={col}
                            draggable
                            onDragStart={() => onDragStart(col)}
                            onDragEnter={() => onDragEnter(col)}
                            onDragOver={(e) => e.preventDefault()}
                            onDragEnd={onDragEnd}
                            onClick={() => handleSort(col)}
                            style={{
                              padding: '5px 24px 5px 10px',
                              boxSizing: 'border-box',
                              minWidth: columnWidth,
                              width: columnWidth,
                              textAlign: 'left',
                              background: dragTarget === col ? '#dbeafe' : '#f1f5f9',
                              borderBottom: '2px solid #e2e8f0',
                              borderRight: '1px solid #e2e8f0',
                              cursor: 'pointer',
                              whiteSpace: 'nowrap',
                              color: sortCol === col ? '#2563eb' : '#475569',
                              userSelect: 'none',
                              outline: dragTarget === col ? '2px solid #3b82f6' : 'none',
                              outlineOffset: -2,
                              position: isPinned ? 'sticky' : 'relative',
                              left: isPinned ? `${pinnedLeft}px` : undefined,
                              zIndex: isPinned ? 2 : undefined,
                            }}
                          >
                            {col}{sortIndicator(col)}
                            <button
                              onClick={(e) => { e.stopPropagation(); togglePinnedCol(col) }}
                              title={isPinned ? 'Unlock column' : 'Lock column'}
                              style={{
                                position: 'absolute',
                                right: 4,
                                top: '50%',
                                transform: 'translateY(-50%)',
                                background: isPinned ? '#e0e7ff' : 'none',
                                border: 'none',
                                borderRadius: 3,
                                color: isPinned ? '#4f46e5' : '#94a3b8',
                                cursor: 'pointer',
                                fontSize: 10,
                                padding: '1px 3px',
                                lineHeight: 1,
                              }}
                            >
                              🔒
                            </button>
                          </th>
                        )
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {(sorted as TableRow[])
                      .filter((row) =>
                        !search || columns.some((col) =>
                          (row[col] ?? '').toLowerCase().includes(search.toLowerCase())
                        )
                      )
                      .map((row, i) => {
                      const origIdx = rows.indexOf(row)
                      const isHighlight = highlightRow === origIdx
                      return (
                      <tr
                        key={i}
                        ref={(el) => { if (origIdx >= 0) rowRefs.current[origIdx] = el }}
                        style={{ background: isHighlight ? 'rgba(251,191,36,0.25)' : (i % 2 === 0 ? '#ffffff' : '#f8fafc') }}
                      >
                        {columns.map((col) => {
                          const isPinned = pinnedCols.has(col)
                          const pinnedLeft = getPinnedLeft(col)
                          const columnWidth = getColumnWidth(col)

                          return (
                            <td
                              key={col}
                              style={{
                                padding: '3px 10px',
                                boxSizing: 'border-box',
                                minWidth: columnWidth,
                                width: columnWidth,
                                borderBottom: '1px solid #f1f5f9',
                                borderRight: '1px solid #f1f5f9',
                                whiteSpace: 'nowrap',
                                maxWidth: 200,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                color: '#334155',
                                position: isPinned ? 'sticky' : undefined,
                                left: isPinned ? `${pinnedLeft}px` : undefined,
                                zIndex: isPinned ? 1 : undefined,
                                background: isPinned ? (i % 2 === 0 ? '#ffffff' : '#f8fafc') : undefined,
                              }}
                              title={row[col]}
                            >
                              {(() => {
                                const text = row[col] ?? ''
                                if (!search) return text
                                const idx = text.toLowerCase().indexOf(search.toLowerCase())
                                if (idx === -1) return text
                                return (
                                  <>
                                    {text.slice(0, idx)}
                                    <mark style={{ background: '#fbbf24', color: '#1e293b', borderRadius: 2 }}>
                                      {text.slice(idx, idx + search.length)}
                                    </mark>
                                    {text.slice(idx + search.length)}
                                  </>
                                )
                              })()}
                            </td>
                          )
                        })}
                      </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </div>

            <div
              onMouseDown={onResizeY}
              className="nodrag"
              style={{ height: 6, cursor: 'ns-resize', background: '#e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '0 0 8px 8px' }}
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
  background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: '0 2px', fontSize: 11, fontFamily: 'ui-monospace, Consolas, monospace',
}
const headerTitleStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0,
}
const filenameStyle: React.CSSProperties = {
  flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#334155',
}
const headerDividerStyle: React.CSSProperties = {
  width: 1, height: 12, background: '#e2e8f0', flexShrink: 0,
}
const hostnameStyle: React.CSSProperties = {
  maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#94a3b8', fontSize: 11, flexShrink: 1,
}
