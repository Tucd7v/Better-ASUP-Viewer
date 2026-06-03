import { useEffect, useRef, useState } from 'react'
import type { NodeProps, Node } from '@xyflow/react'
import { getFileContent } from '../../../services/api'
import { useResizable } from './useResizable'
import { useViewer } from '../ViewerContext'

export interface TextFileCardData extends Record<string, unknown> {
  fileId: string
  sessionId: string
  filename: string
  nodeColor: string
  collapsed: boolean
  splitMode?: boolean
  onCollapse: () => void
  onHide: () => void
}

export type TextFileNode = Node<TextFileCardData, 'textFile'>

function highlight(line: string, term: string): React.ReactNode {
  if (!term) return line
  const idx = line.toLowerCase().indexOf(term.toLowerCase())
  if (idx === -1) return line
  return (
    <>
      {line.slice(0, idx)}
      <mark style={{ background: '#fbbf24', color: '#1e293b', borderRadius: 2 }}>
        {line.slice(idx, idx + term.length)}
      </mark>
      {line.slice(idx + term.length)}
    </>
  )
}

export default function TextFileCard({ data }: NodeProps<TextFileNode>) {
  const { fileId, sessionId, filename, nodeColor, collapsed, splitMode, onCollapse, onHide } = data
  const { width, height, onResizeX, onResizeY } = useResizable(900, 340)

  const [lines, setLines] = useState<string[]>([])
  const [totalLines, setTotalLines] = useState(0)
  const [page, setPage] = useState(0)
  const [search, setSearch] = useState('')
  const [matchIndex, setMatchIndex] = useState(0)
  const [loading, setLoading] = useState(false)
  const LIMIT = 5000
  const listRef = useRef<HTMLDivElement>(null)
  const matchRefs = useRef<(HTMLDivElement | null)[]>([])
  const { state, dispatch: viewDispatch } = useViewer()
  const hostname = state.sessions.find((session) => session.sessionId === sessionId)?.hostname?.trim() ?? ''

  useEffect(() => {
    if (collapsed) return
    setLoading(true)
    getFileContent(sessionId, fileId, page * LIMIT, LIMIT)
      .then((res) => {
        const d = res.data
        if (Array.isArray(d.lines)) {
          setLines(d.lines)
          setTotalLines(d.total_lines ?? d.lines.length)
        }
      })
      .catch(() => setLines([]))
      .finally(() => setLoading(false))
  }, [fileId, sessionId, page, collapsed])

  // Respond to global search
  useEffect(() => {
    const gs = state.globalSearch
    if (gs && gs.fileId === fileId && gs.query) {
      setSearch(gs.query)
      if (gs.line !== undefined) {
        const targetPage = Math.floor((gs.line - 1) / LIMIT)
        setPage(targetPage)
        setTimeout(() => {
          const targetEl = matchRefs.current[gs.line - 1]
          if (targetEl) {
            targetEl.scrollIntoView({ block: 'center', behavior: 'smooth' })
          }
        }, 300)
      }
      viewDispatch({ type: 'CLEAR_GLOBAL_SEARCH' })
    }
  }, [state.globalSearch])

  const matchIndices = search
    ? lines.reduce<number[]>((acc, l, i) => {
        if (l.toLowerCase().includes(search.toLowerCase())) acc.push(i)
        return acc
      }, [])
    : []

  useEffect(() => { setMatchIndex(0) }, [search])

  const scrollToMatch = (idx: number) => {
    const el = matchRefs.current[matchIndices[idx]]
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }

  const totalPages = Math.max(1, Math.ceil(totalLines / LIMIT))

  return (
    <div style={{ position: 'relative', width: splitMode ? '100%' : width, minWidth: splitMode ? undefined : 220, height: splitMode ? '100%' : undefined }}>
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
        {/* header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', background: '#f8fafc', borderBottom: collapsed ? 'none' : '1px solid #e2e8f0' }}>
          <span>📄</span>
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
                style={{ ...inputStyle, flex: 1 }}
                className="nodrag"
              />
              {search && (
                <>
                  <span style={{ fontSize: 10, color: '#94a3b8', alignSelf: 'center', whiteSpace: 'nowrap' }}>
                    {matchIndices.length === 0 ? '0/0' : `${matchIndex + 1}/${matchIndices.length}`}
                  </span>
                  <button style={navBtnStyle} disabled={matchIndices.length === 0} onClick={() => {
                    const next = (matchIndex - 1 + matchIndices.length) % matchIndices.length
                    setMatchIndex(next)
                    scrollToMatch(next)
                  }}>↑</button>
                  <button style={navBtnStyle} disabled={matchIndices.length === 0} onClick={() => {
                    const next = (matchIndex + 1) % matchIndices.length
                    setMatchIndex(next)
                    scrollToMatch(next)
                  }}>↓</button>
                </>
              )}
            </div>

            <div ref={listRef} style={{ height: splitMode ? undefined : height, overflowY: 'auto', flex: splitMode ? 1 : undefined, minHeight: splitMode ? 0 : undefined, padding: '4px 0', userSelect: 'text', cursor: 'text' }} className="nodrag nowheel" onPointerDown={(e) => e.stopPropagation()}>
              {loading ? (
                <div style={{ padding: '8px 10px', color: '#94a3b8' }}>Loading…</div>
              ) : (
                lines.map((line, i) => {
                  const isMatch = search && line.toLowerCase().includes(search.toLowerCase())
                  const isCurrent = isMatch && matchIndices[matchIndex] === i
                  return (
                    <div
                      key={i}
                      ref={(el) => { matchRefs.current[i] = el }}
                      style={{
                        display: 'flex',
                        gap: 8,
                        padding: '1px 10px',
                        background: isCurrent ? 'rgba(251,191,36,0.2)' : isMatch ? 'rgba(251,191,36,0.08)' : 'transparent',
                      }}
                    >
                      <span style={{ color: '#cbd5e1', minWidth: 36, textAlign: 'right', userSelect: 'none' }}>
                        {page * LIMIT + i + 1}
                      </span>
                      <span style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                        {highlight(line, search)}
                      </span>
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
const inputStyle: React.CSSProperties = {
  width: '100%', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 4, color: '#1e293b', padding: '3px 6px', fontSize: 11, fontFamily: 'ui-monospace, Consolas, monospace', outline: 'none',
}
const navBtnStyle: React.CSSProperties = {
  background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: 11, padding: '2px 4px', fontFamily: 'ui-monospace, Consolas, monospace',
}
