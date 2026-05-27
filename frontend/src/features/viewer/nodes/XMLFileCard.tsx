import { useEffect, useRef, useState } from 'react'
import type { NodeProps, Node } from '@xyflow/react'
import { Handle, Position } from '@xyflow/react'
import { getFileContent } from '../../../services/api'
import { useResizable } from './useResizable'

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

interface TableRow { [key: string]: string }
type SortDir = 'asc' | 'desc' | null

const MENU_WIDTH = 180

function ColSwapMenu({
  allCols,
  targetCol,
  left,
  top,
  cardWidth,
  onSelect,
  onClose,
}: {
  allCols: string[]
  targetCol: string
  left: number
  top: number
  cardWidth: number
  onSelect: (col: string) => void
  onClose: () => void
}) {
  // Clamp so menu never spills beyond card right edge
  const clampedLeft = Math.min(left, cardWidth - MENU_WIDTH)

  return (
    <>
      {/* Full-card transparent backdrop to catch outside clicks */}
      <div
        style={{ position: 'absolute', inset: 0, zIndex: 9998 }}
        onMouseDown={() => onClose()}
      />
      <div
        style={{
          position: 'absolute',
          top,
          left: clampedLeft,
          transform: 'translateY(-100%)',
          zIndex: 9999,
          background: '#ffffff',
          border: '1px solid #e2e8f0',
          borderRadius: 6,
          boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
          width: MENU_WIDTH,
          maxHeight: 240,
          overflowY: 'auto',
          fontFamily: 'ui-monospace, Consolas, monospace',
          fontSize: 11,
        }}
        onMouseDown={(e) => e.stopPropagation()}
        className="nowheel nodrag"
      >
        {allCols.map((col) => (
          <div
            key={col}
            onClick={() => { onSelect(col); onClose() }}
            style={{
              padding: '6px 12px',
              cursor: 'pointer',
              color: col === targetCol ? '#2563eb' : '#334155',
              background: col === targetCol ? '#eff6ff' : 'transparent',
              fontWeight: col === targetCol ? 600 : 400,
            }}
            onMouseEnter={(e) => { if (col !== targetCol) (e.currentTarget as HTMLDivElement).style.background = '#f1f5f9' }}
            onMouseLeave={(e) => { if (col !== targetCol) (e.currentTarget as HTMLDivElement).style.background = 'transparent' }}
          >
            {col}
          </div>
        ))}
      </div>
    </>
  )
}

export default function XMLFileCard({ data }: NodeProps<XMLFileNode>) {
  const { fileId, sessionId, filename, nodeColor, collapsed, onCollapse, onHide } = data
  const { width, height, setWidth, onResizeX, onResizeY } = useResizable(320, 360)

  const [rows, setRows] = useState<TableRow[]>([])
  const [allColumns, setAllColumns] = useState<string[]>([])
  const [columns, setColumns] = useState<string[]>([])
  const [sortCol, setSortCol] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<SortDir>(null)
  const [loading, setLoading] = useState(false)
  const [tableWidth, setTableWidth] = useState(0)

  const dragCol = useRef<string | null>(null)
  const dragOverCol = useRef<string | null>(null)
  const [dragTarget, setDragTarget] = useState<string | null>(null)

  const [swapMenuCol, setSwapMenuCol] = useState<string | null>(null)
  const [swapMenuPos, setSwapMenuPos] = useState<{ left: number; top: number }>({ left: 0, top: 0 })
  const wrapperRef = useRef<HTMLDivElement>(null)
  const thRefs = useRef<Map<string, HTMLTableCellElement>>(new Map())

  useEffect(() => {
    if (collapsed) return
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
          setTableWidth(colW)
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
            setTableWidth(colW)
            setWidth(Math.max(320, Math.min(1000, colW + 20)))
          }
        }
      })
      .catch(() => setRows([]))
      .finally(() => setLoading(false))
  }, [fileId, sessionId, collapsed])

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
    if (swapMenuCol === col) { setSwapMenuCol(null); return }
    const th = thRefs.current.get(col)
    const wrapper = wrapperRef.current
    if (th && wrapper) {
      const thRect = th.getBoundingClientRect()
      const wRect = wrapper.getBoundingClientRect()
      setSwapMenuPos({
        left: thRect.left - wRect.left,
        top: thRect.top - wRect.top - 4,
      })
    }
    setSwapMenuCol(col)
  }

  const needsScroll = tableWidth > 0 && tableWidth > width - 20

  const sortIndicator = (col: string) => {
    if (sortCol !== col || !sortDir) return ''
    return sortDir === 'asc' ? ' ↑' : ' ↓'
  }

  return (
    <div ref={wrapperRef} style={{ position: 'relative', width }}>
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
          overflow: 'visible',
          position: 'relative',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', background: '#f8fafc', borderBottom: collapsed ? 'none' : '1px solid #e2e8f0', borderRadius: collapsed ? 8 : '8px 8px 0 0' }}>
          <span>📊</span>
          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#334155' }} title={filename}>
            {filename}
          </span>
          <button onClick={onCollapse} style={btnStyle} title={collapsed ? 'Expand' : 'Collapse'}>
            {collapsed ? '[+]' : '[−]'}
          </button>
          <button onClick={onHide} style={btnStyle} title="Hide">[×]</button>
        </div>

        {!collapsed && (
          <>
            <div
              style={{
                maxHeight: height,
                overflowX: needsScroll ? 'scroll' : 'hidden',
                overflowY: 'auto',
                borderRadius: '0 0 8px 8px',
              }}
              className="nodrag nowheel"
            >
              {loading ? (
                <div style={{ padding: '8px 10px', color: '#94a3b8' }}>Loading…</div>
              ) : rows.length === 0 ? (
                <div style={{ padding: '8px 10px', color: '#94a3b8' }}>No data</div>
              ) : (
                <table style={{ borderCollapse: 'collapse', fontSize: 11, tableLayout: 'auto' }}>
                  <thead>
                    <tr>
                      {columns.map((col) => (
                        <th
                          key={col}
                          ref={(el) => { if (el) thRefs.current.set(col, el); else thRefs.current.delete(col) }}
                          draggable
                          onDragStart={() => onDragStart(col)}
                          onDragEnter={() => onDragEnter(col)}
                          onDragOver={(e) => e.preventDefault()}
                          onDragEnd={onDragEnd}
                          onClick={() => handleSort(col)}
                          style={{
                            padding: '5px 24px 5px 10px',
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
                            position: 'relative',
                          }}
                        >
                          {col}{sortIndicator(col)}
                          <button
                            onClick={(e) => openSwapMenu(col, e)}
                            title="Switch column"
                            style={{
                              position: 'absolute',
                              right: 4,
                              top: '50%',
                              transform: 'translateY(-50%)',
                              background: swapMenuCol === col ? '#e0e7ff' : 'none',
                              border: 'none',
                              borderRadius: 3,
                              color: swapMenuCol === col ? '#4f46e5' : '#94a3b8',
                              cursor: 'pointer',
                              fontSize: 10,
                              padding: '1px 3px',
                              lineHeight: 1,
                            }}
                          >
                            ⇄
                          </button>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.map((row, i) => (
                      <tr key={i} style={{ background: i % 2 === 0 ? '#ffffff' : '#f8fafc' }}>
                        {columns.map((col) => (
                          <td
                            key={col}
                            style={{
                              padding: '3px 10px',
                              borderBottom: '1px solid #f1f5f9',
                              borderRight: '1px solid #f1f5f9',
                              whiteSpace: 'nowrap',
                              maxWidth: 200,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              color: '#334155',
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

            <div
              onMouseDown={onResizeY}
              className="nodrag"
              style={{ height: 6, cursor: 'ns-resize', background: '#e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '0 0 8px 8px' }}
            >
              <div style={{ width: 30, height: 2, borderRadius: 1, background: '#94a3b8' }} />
            </div>
          </>
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
          targetCol={swapMenuCol}
          left={swapMenuPos.left}
          top={swapMenuPos.top}
          cardWidth={width}
          onSelect={(newCol) => handleSwap(swapMenuCol, newCol)}
          onClose={() => setSwapMenuCol(null)}
        />
      )}
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

export const leftHandleStyle: React.CSSProperties = {
  ...handleStyle,
  transform: 'translate(calc(-50% - 10px), -50%)',
}
export const rightHandleStyle: React.CSSProperties = {
  ...handleStyle,
  transform: 'translate(calc(50% + 10px), -50%)',
}

const btnStyle: React.CSSProperties = {
  background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: '0 2px', fontSize: 11, fontFamily: 'ui-monospace, Consolas, monospace',
}
