import { useState } from 'react'
import { Link } from 'react-router-dom'
import { getNodeSessions, deleteSession } from '../../services/api'
import type { Session } from '../../types'

interface NodeRowProps {
  clusterId: string
  nodeId: string
  serialNum: string
  osVersion: string
  sessionCount: number
  latestSessionId?: string
}

export default function NodeRow({
  clusterId,
  nodeId,
  serialNum,
  osVersion,
  sessionCount,
  latestSessionId,
}: NodeRowProps) {
  const [expanded, setExpanded] = useState(false)
  const [sessions, setSessions] = useState<Session[]>([])
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)

  const [deletingId, setDeletingId] = useState<string | null>(null)

  const handleDelete = async (sessionId: string) => {
    if (!window.confirm('Delete this session and all its files?')) return
    setDeletingId(sessionId)
    try {
      await deleteSession(sessionId)
      setSessions((prev) => prev.filter((s) => s.id !== sessionId))
    } finally {
      setDeletingId(null)
    }
  }

  const toggleHistory = () => {
    if (!expanded && !loaded) {
      setLoading(true)
      getNodeSessions(clusterId, nodeId)
        .then((res) => {
          setSessions(res.data?.sessions ?? res.data ?? [])
          setLoaded(true)
        })
        .catch(() => setSessions([]))
        .finally(() => setLoading(false))
    }
    setExpanded((v) => !v)
  }

  return (
    <div
      style={{
        background: '#f8fafc',
        border: '1px solid #e2e8f0',
        borderRadius: 6,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '10px 14px',
          flexWrap: 'wrap',
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <span
            style={{
              fontFamily: 'ui-monospace, Consolas, monospace',
              fontSize: 13,
              color: '#1e293b',
            }}
          >
            {serialNum}
          </span>
          {osVersion && (
            <span style={{ fontSize: 11, color: '#94a3b8', marginLeft: 8 }}>
              {osVersion}
            </span>
          )}
        </div>
        <span style={{ fontSize: 11, color: '#64748b' }}>
          {sessionCount} session{sessionCount !== 1 ? 's' : ''}
        </span>
        {latestSessionId && (
          <Link
            to={`/viewer/${latestSessionId}`}
            style={{
              fontSize: 12,
              color: '#3b82f6',
              textDecoration: 'none',
              background: 'rgba(59,130,246,0.08)',
              border: '1px solid rgba(59,130,246,0.25)',
              borderRadius: 4,
              padding: '3px 8px',
            }}
          >
            View Latest
          </Link>
        )}
        <button
          onClick={toggleHistory}
          style={{
            background: 'none',
            border: '1px solid #e2e8f0',
            borderRadius: 4,
            color: '#64748b',
            cursor: 'pointer',
            fontSize: 11,
            padding: '3px 8px',
          }}
        >
          {expanded ? 'Hide History' : 'History'}
        </button>
      </div>

      {expanded && (
        <div style={{ borderTop: '1px solid #e2e8f0', padding: '8px 14px' }}>
          {loading ? (
            <div style={{ color: '#94a3b8', fontSize: 12, padding: '8px 0' }}>Loading…</div>
          ) : sessions.length === 0 ? (
            <div style={{ color: '#94a3b8', fontSize: 12, padding: '8px 0' }}>
              No sessions found
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {sessions.map((s) => (
                <div
                  key={s.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '6px 10px',
                    background: '#ffffff',
                    border: '1px solid #f1f5f9',
                    borderRadius: 4,
                    flexWrap: 'wrap',
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 12,
                        color: '#475569',
                        fontFamily: 'ui-monospace, Consolas, monospace',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                      title={s.original_filename}
                    >
                      {s.original_filename}
                    </div>
                    <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>
                      {formatDate(s.generated_on)} · {s.file_count} file
                      {s.file_count !== 1 ? 's' : ''}
                    </div>
                  </div>
                  {s.group_id && (
                    <Link
                      to={`/viewer/group/${s.group_id}`}
                      style={{
                        fontSize: 11,
                        color: '#2563eb',
                        textDecoration: 'none',
                        background: 'rgba(37,99,235,0.06)',
                        border: '1px solid rgba(37,99,235,0.2)',
                        borderRadius: 3,
                        padding: '2px 6px',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      🔗 Dual Node
                    </Link>
                  )}
                  <Link
                    to={`/viewer/${s.id}`}
                    style={{
                      fontSize: 13,
                      color: '#3b82f6',
                      textDecoration: 'none',
                    }}
                    title="Open in viewer"
                  >
                    →
                  </Link>
                  <button
                    onClick={() => handleDelete(s.id)}
                    disabled={deletingId === s.id}
                    title="Delete session"
                    style={{
                      background: 'none',
                      border: 'none',
                      color: deletingId === s.id ? '#cbd5e1' : '#f87171',
                      cursor: deletingId === s.id ? 'wait' : 'pointer',
                      fontSize: 13,
                      padding: '0 2px',
                    }}
                  >
                    🗑
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function formatDate(iso: string): string {
  if (!iso) return '—'
  try {
    const d = new Date(iso.endsWith('Z') ? iso : iso + 'Z')
    const yyyy = d.getFullYear()
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    const dd = String(d.getDate()).padStart(2, '0')
    const hh = String(d.getHours()).padStart(2, '0')
    const min = String(d.getMinutes()).padStart(2, '0')
    const ss = String(d.getSeconds()).padStart(2, '0')
    return `${yyyy}-${mm}-${dd} ${hh}:${min}:${ss}`
  } catch {
    return iso
  }
}
