import { useEffect, useMemo, useState } from 'react'
import type { SessionMeta } from '../../types'

interface NodeHUDProps {
  sessions: Array<Omit<SessionMeta, 'nodeColor'> & { nodeColor?: string }>
}

export default function NodeHUD({ sessions }: NodeHUDProps) {
  const [page, setPage] = useState(0)
  const rows = sessions.length
    ? sessions
    : [
        {
          sessionId: '',
          serialNum: '',
          generatedOn: '',
          nodeColor: '#3b82f6',
          hostname: 'NodeA',
          status: 'healthy',
        },
      ]

  const primary = rows[0]
  const clusterLabel = primary?.clusterId || 'PROD-01'
  const asupTime = rows.find((s) => s.generatedOn)?.generatedOn ?? ''
  const multiNode = rows.length > 2
  const rowsPerCol = rows.length === 4 ? 2 : 3
  const maxVisible = rowsPerCol * 2
  const pageCount = Math.ceil(rows.length / maxVisible)
  const hasPages = pageCount > 1
  const visibleRows = useMemo(
    () => rows.slice(page * maxVisible, page * maxVisible + maxVisible),
    [maxVisible, page, rows],
  )

  useEffect(() => {
    setPage((current) => Math.min(current, Math.max(0, pageCount - 1)))
  }, [pageCount])

  return (
    <div className={`node-hud-bar${multiNode ? ' node-hud-bar--multi' : ''}`}>
      <div className="hud-cluster">
        <span className="hud-label">Cluster:</span>
        <span className="hud-cluster-name">{clusterLabel}</span>
      </div>

      {multiNode ? (
        <div className="hud-node-pager">
          <div
            className="hud-node-list"
            style={{ gridTemplateRows: `repeat(${rowsPerCol}, auto)` }}
          >
            {visibleRows.map((session, index) => renderNode(session, page * maxVisible + index))}
          </div>
          {hasPages && (
            <div className="hud-node-page-actions">
              <button
                type="button"
                aria-label="Previous nodes"
                disabled={page === 0}
                onClick={() => setPage((current) => Math.max(0, current - 1))}
              >
                ←
              </button>
              <span>{page + 1}/{pageCount}</span>
              <button
                type="button"
                aria-label="Next nodes"
                disabled={page >= pageCount - 1}
                onClick={() => setPage((current) => Math.min(pageCount - 1, current + 1))}
              >
                →
              </button>
            </div>
          )}
        </div>
      ) : (
        rows.map((session, index) => renderNode(session, index))
      )}

      <div className="hud-asup">
        <span className="hud-label">ASUP:</span>
        <span>{formatDate(asupTime)}</span>
      </div>

    </div>
  )
}

function renderNode(
  session: Omit<SessionMeta, 'nodeColor'> & { nodeColor?: string },
  index: number,
) {
  const nodeName = session.hostname || fallbackNodeName(index)

  return (
    <div className="hud-node" key={session.sessionId || `${nodeName}-${index}`}>
      <span
        className="hud-node-dot"
        style={{ backgroundColor: session.nodeColor ?? fallbackNodeColor(index) }}
      />
      <span className="hud-node-name">{nodeName}</span>
      <span className="hud-node-serial">{shortSerial(session.serialNum || session.sessionId)}</span>
    </div>
  )
}

function fallbackNodeColor(index: number): string {
  return index === 0 ? '#3b82f6' : '#f97316'
}

function fallbackNodeName(index: number): string {
  if (index === 0) return 'NodeA'
  if (index === 1) return 'NodeB'
  return `Node${index + 1}`
}

function formatDate(iso: string): string {
  if (!iso) return '—'
  try {
    const d = new Date(iso)
    const yyyy = d.getFullYear()
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    const dd = String(d.getDate()).padStart(2, '0')
    const hh = String(d.getHours()).padStart(2, '0')
    const min = String(d.getMinutes()).padStart(2, '0')
    return `${yyyy}-${mm}-${dd} ${hh}:${min}`
  } catch {
    return iso
  }
}

function shortSerial(value: string): string {
  if (!value) return '—'
  return value.length > 13 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value
}
