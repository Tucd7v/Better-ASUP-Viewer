import { useEffect, useRef, useState } from 'react'
import type { NodeProps, Node } from '@xyflow/react'
import { getFileContent } from '../../../services/api'
import { useResizable } from './useResizable'
import { useViewer } from '../ViewerContext'

export interface XMLFileCardData extends Record<string, unknown> {
  fileId: string
  sessionId: string
  filename: string
  aiSummary?: string
  nodeColor: string
  collapsed: boolean
  splitMode?: boolean
  onCollapse: () => void
  onHide: () => void
  onDuplicate: () => void
  onReadyForViewport?: (nodeId: string, size?: { width?: number; height?: number }) => void
}

export type XMLFileNode = Node<XMLFileCardData, 'xmlFile'>

interface TableRow { [key: string]: string }
type SortDir = 'asc' | 'desc' | null

const MENU_WIDTH = 180

function ColSwapMenu({
  allCols,
  targetSlot,
  left,
  top,
  cardWidth,
  onSelect,
  onClose,
}: {
  allCols: string[]
  targetSlot: string
  left: number
  top: number
  cardWidth: number
  onSelect: (col: string) => void
  onClose: () => void
}) {
  const clampedLeft = Math.max(0, Math.min(left, cardWidth - MENU_WIDTH))
  const [filter, setFilter] = useState('')
  const filtered = filter
    ? allCols.filter((c) => c.toLowerCase().includes(filter.toLowerCase()))
    : allCols

  return (
    <>
      <div style={{ position: 'absolute', inset: 0, zIndex: 9998 }} onClick={onClose} />
      <div
        style={{
          position: 'absolute',
          top,
          left: clampedLeft,
          zIndex: 9999,
          background: '#fff',
          border: '1px solid #e2e8f0',
          borderRadius: 6,
          boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
          width: MENU_WIDTH,
          maxHeight: 240,
          fontFamily: 'ui-monospace, Consolas, monospace',
          fontSize: 11,
          display: 'flex',
          flexDirection: 'column',
        }}
        onClick={(e) => e.stopPropagation()}
        className="nowheel nodrag"
      >
        <div style={{ padding: '4px 6px', borderBottom: '1px solid #e2e8f0', flexShrink: 0 }}>
          <input
            type="text"
            placeholder="Filter…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="nodrag"
            autoFocus
            style={{
              width: '100%',
              border: '1px solid #e2e8f0',
              borderRadius: 4,
              padding: '3px 6px',
              fontSize: 11,
              fontFamily: 'ui-monospace, Consolas, monospace',
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />
        </div>
        <div style={{ overflowY: 'auto', flex: 1 }}>
        {filtered.map((col) => (
          <div
            key={col}
            onClick={() => { onSelect(col); onClose() }}
            style={{
              padding: '6px 12px',
              cursor: 'pointer',
              color: col === targetSlot ? '#2563eb' : '#334155',
              background: col === targetSlot ? '#eff6ff' : 'transparent',
              fontWeight: col === targetSlot ? 600 : 400,
            }}
            onMouseEnter={(e) => { if (col !== targetSlot) e.currentTarget.style.background = '#f1f5f9' }}
            onMouseLeave={(e) => { if (col !== targetSlot) e.currentTarget.style.background = 'transparent' }}
          >
            {col}
          </div>
        ))}
        </div>
      </div>
    </>
  )
}

export default function XMLFileCard({ data }: NodeProps<XMLFileNode>) {
  const { fileId, sessionId, filename, aiSummary: dataAiSummary, nodeColor, collapsed, splitMode, onCollapse, onHide, onDuplicate, onReadyForViewport } = data
  const { width, height, setWidth, onResizeX, onResizeY } = useResizable(320, 360)

  const [rows, setRows] = useState<TableRow[]>([])
  const [allColumns, setAllColumns] = useState<string[]>([])
  const [columns, setColumns] = useState<string[]>([])
  const [sortCol, setSortCol] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<SortDir>(null)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [contentReady, setContentReady] = useState(false)
  const [pinnedCols, setPinnedCols] = useState<Set<string>>(new Set())
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({})

  const dragCol = useRef<string | null>(null)
  const dragOverCol = useRef<string | null>(null)
  const resizeCol = useRef<{ col: string; startX: number; startWidth: number } | null>(null)
  const [dragTarget, setDragTarget] = useState<string | null>(null)
  const [resizingCol, setResizingCol] = useState<string | null>(null)
  const [swapMenuCol, setSwapMenuCol] = useState<string | null>(null)
  const [swapMenuPos, setSwapMenuPos] = useState<{ left: number; top: number }>({ left: 0, top: 0 })
  const [swapMenuCardWidth, setSwapMenuCardWidth] = useState(width)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const thRefs = useRef<Map<string, HTMLTableCellElement>>(new Map())
  const swapMenuFrame = useRef<number | null>(null)
  const viewportReadyReported = useRef(false)

  const rowRefs = useRef<(HTMLTableRowElement | null)[]>([])
  const [highlightRow, setHighlightRow] = useState<number | null>(null)
  const { state, dispatch: viewDispatch } = useViewer()
  const sessionMeta = state.sessions.find((session) => session.sessionId === sessionId)
  const hostname = sessionMeta?.hostname?.trim() ?? ''
  const aiSummary = (dataAiSummary || sessionMeta?.aiSummary || sessionMeta?.ai_summary || '').trim()
  const getColumnWidth = (col: string) => Math.max(100, col.length * 9)

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      const current = resizeCol.current
      if (!current) return

      const nextWidth = Math.max(50, current.startWidth + (e.clientX - current.startX))
      setColumnWidths((prev) => ({ ...prev, [current.col]: nextWidth }))
    }

    const onMouseUp = () => {
      if (!resizeCol.current) return
      resizeCol.current = null
      setResizingCol(null)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
    return () => {
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [])

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
        if (Array.isArray(d.rows) && d.rows.length > 0) {
          const cols = Object.keys(d.rows[0])
          setAllColumns(cols)
          setColumns(cols)
          setRows(d.rows)
          const colW = cols.reduce((sum, c) => sum + Math.max(100, c.length * 9), 0)
          setWidth(Math.max(320, Math.min(1000, colW + 20)))
        } else if (Array.isArray(d.lines)) {
          const ls: string[] = d.lines
          if (ls.length > 0) {
            const cols = ls[0].split('\t')
            setAllColumns(cols)
            setColumns(cols)
            const rowData = ls.slice(1).map((l) => {
              const vals = l.split('\t')
              return Object.fromEntries(cols.map((c, i) => [c, vals[i] ?? '']))
            })
            setRows(rowData)
            const colW = cols.reduce((sum, c) => sum + Math.max(100, c.length * 9), 0)
            setWidth(Math.max(320, Math.min(1000, colW + 20)))
          }
        }
      })
      .catch(() => setRows([]))
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

  useEffect(() => {
    return () => {
      if (swapMenuFrame.current !== null) {
        cancelAnimationFrame(swapMenuFrame.current)
      }
    }
  }, [])

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

  const handleSwap = (targetSlot: string, newCol: string) => {
    if (targetSlot === newCol) return
    setColumns((cols) => {
      const next = [...cols]
      const targetIdx = next.indexOf(targetSlot)
      const newIdx = next.indexOf(newCol)
      if (newIdx !== -1) {
        next[targetIdx] = newCol
        next[newIdx] = targetSlot
      } else {
        next[targetIdx] = newCol
      }
      return next
    })
  }

  const openSwapMenu = (col: string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (swapMenuFrame.current !== null) {
      cancelAnimationFrame(swapMenuFrame.current)
      swapMenuFrame.current = null
    }
    if (swapMenuCol === col) {
      setSwapMenuCol(null)
      return
    }
    if (rows.length === 0) return

    setSwapMenuCol(null)
    swapMenuFrame.current = requestAnimationFrame(() => {
      swapMenuFrame.current = null
      const th = thRefs.current.get(col)
      const wrapper = wrapperRef.current
      if (!th || !wrapper) return

      const thRect = th.getBoundingClientRect()
      const wRect = wrapper.getBoundingClientRect()
      const scaleX = wrapper.offsetWidth > 0 ? wRect.width / wrapper.offsetWidth : 1
      const scaleY = wrapper.offsetHeight > 0 ? wRect.height / wrapper.offsetHeight : scaleX
      setSwapMenuPos({
        left: (thRect.left - wRect.left) / (scaleX || 1),
        top: (thRect.bottom - wRect.top) / (scaleY || 1) + 4,
      })
      setSwapMenuCardWidth(wrapper.offsetWidth || width)
      setSwapMenuCol(col)
    })
  }

  const togglePinnedCol = (col: string) => {
    setPinnedCols((prev) => {
      const next = new Set(prev)
      if (next.has(col)) next.delete(col)
      else next.add(col)
      return next
    })
  }

  const startColumnResize = (col: string, e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    resizeCol.current = {
      col,
      startX: e.clientX,
      startWidth: columnWidths[col] || getColumnWidth(col),
    }
    setResizingCol(col)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }

  const getPinnedLeft = (col: string) => {
    let left = 0
    for (const current of columns) {
      if (current === col) return left
      if (pinnedCols.has(current)) left += columnWidths[current] || getColumnWidth(current)
    }
    return left
  }

  return (
    <div ref={wrapperRef} style={{ position: 'relative', width: splitMode ? '100%' : width, height: splitMode ? '100%' : undefined }}>
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
          <button type="button" className="nodrag" onClick={onHide} style={btnStyle} title="Hide">[×]</button>
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
                overflowX: 'auto',
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
                        const columnWidth = columnWidths[col] || getColumnWidth(col)

                        return (
                          <th
                            key={col}
                            ref={(el) => { if (el) thRefs.current.set(col, el); else thRefs.current.delete(col) }}
                            draggable
                            onDragStart={() => onDragStart(col)}
                            onDragEnter={() => onDragEnter(col)}
                            onDragOver={(e) => e.preventDefault()}
                            onDragEnd={onDragEnd}
                            style={{
                              padding: '5px 72px 5px 10px',
                              boxSizing: 'border-box',
                              minWidth: columnWidth,
                              width: columnWidth,
                              textAlign: 'left',
                              background: dragTarget === col ? '#dbeafe' : '#f1f5f9',
                              borderBottom: '2px solid #e2e8f0',
                              borderRight: '1px solid #e2e8f0',
                              cursor: resizingCol === col ? 'col-resize' : 'pointer',
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
                            <span
                              style={{
                                display: 'block',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              }}
                              title={col}
                            >
                              {col}
                            </span>
                            <div
                              className="nodrag"
                              onMouseDown={(e) => startColumnResize(col, e)}
                              onClick={(e) => e.stopPropagation()}
                              style={{
                                position: 'absolute',
                                top: 0,
                                right: -2,
                                width: 4,
                                height: '100%',
                                cursor: 'col-resize',
                                zIndex: 4,
                              }}
                            />
                            <button
                              type="button"
                              className="nodrag"
                              onClick={(e) => { e.stopPropagation(); handleSort(col) }}
                              title="Sort column"
                              style={{
                                position: 'absolute',
                                right: 44,
                                top: '50%',
                                transform: 'translateY(-50%)',
                                width: 16,
                                boxSizing: 'border-box',
                                background: 'none',
                                border: 0,
                                color: sortCol === col ? '#2563eb' : '#94a3b8',
                                cursor: 'pointer',
                                fontSize: 10,
                                padding: '1px 2px',
                                lineHeight: 1,
                                textAlign: 'center',
                              }}
                            >
                              {sortCol === col && sortDir === 'asc' ? '▲' : '▼'}
                            </button>
                            <button
                              onClick={(e) => openSwapMenu(col, e)}
                              title="Switch column"
                              style={{
                                position: 'absolute',
                                right: 24,
                                top: '50%',
                                transform: 'translateY(-50%)',
                                width: 16,
                                boxSizing: 'border-box',
                                background: swapMenuCol === col ? '#e0e7ff' : 'none',
                                border: 'none',
                                borderRadius: 3,
                                color: swapMenuCol === col ? '#4f46e5' : '#94a3b8',
                                cursor: 'pointer',
                                fontSize: 10,
                                padding: '1px 2px',
                                lineHeight: 1,
                                textAlign: 'center',
                              }}
                            >
                              ⇄
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); togglePinnedCol(col) }}
                              title={isPinned ? 'Unlock column' : 'Lock column'}
                              style={{
                                position: 'absolute',
                                right: 4,
                                top: '50%',
                                transform: 'translateY(-50%)',
                                width: 16,
                                boxSizing: 'border-box',
                                background: isPinned ? '#e0e7ff' : 'none',
                                border: 'none',
                                borderRadius: 3,
                                color: isPinned ? '#4f46e5' : '#94a3b8',
                                cursor: 'pointer',
                                fontSize: 10,
                                padding: '1px 2px',
                                lineHeight: 1,
                                textAlign: 'center',
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
                          const columnWidth = columnWidths[col] || getColumnWidth(col)

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
                                maxWidth: columnWidth,
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

      {swapMenuCol && (
        <ColSwapMenu
          allCols={allColumns}
          targetSlot={swapMenuCol}
          left={swapMenuPos.left}
          top={swapMenuPos.top}
          cardWidth={swapMenuCardWidth}
          onSelect={(newCol) => handleSwap(swapMenuCol, newCol)}
          onClose={() => setSwapMenuCol(null)}
        />
      )}
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
  minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#334155', flexShrink: 1, lineHeight: '16px',
}
const aiSummaryBadgeStyle: React.CSSProperties = {
  flexShrink: 0, cursor: 'help', fontSize: 13, lineHeight: '16px',
}
const headerDividerStyle: React.CSSProperties = {
  width: 1, height: 12, background: '#e2e8f0', flexShrink: 0,
}
const hostnameStyle: React.CSSProperties = {
  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#94a3b8', fontSize: 11, flexShrink: 1, lineHeight: '16px', background: 'none', border: 0, padding: 0, cursor: 'pointer', fontFamily: 'ui-monospace, Consolas, monospace',
}
