import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import type { Cluster, ClusterGroup, ClusterGroupMember, ClusterOverview } from '../../types'
import { getClusterOverview, deleteSession } from '../../services/api'

interface ClusterCardProps {
  cluster: Cluster
  autoExpand?: boolean
  onDeleted?: () => void
}

function fmt(iso: string | null): string {
  if (!iso) return '—'
  try {
    const d = new Date(iso.endsWith('Z') ? iso : iso + 'Z')
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  } catch { return iso }
}

function fmtNode(iso: string | null): string {
  if (!iso) return ''
  try {
    const d = new Date(iso)
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())} (ASUP Capture Time)`
  } catch { return '' }
}

function fmtUpload(iso: string | null): string {
  if (!iso) return ''
  try {
    const d = new Date(iso.endsWith('Z') ? iso : iso + 'Z')
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())} (UTC+8)`
  } catch { return '' }
}

function fmtPlain(iso: string | null): string {
  if (!iso) return ''
  try {
    const d = new Date(iso)
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  } catch { return '' }
}

// A single session row (used inside groups and singles)
function SessionRow({ m, onDeleted }: { m: ClusterGroupMember; onDeleted?: () => void }) {
  const [deleting, setDeleting] = useState(false)
  const nodeLabel = m.hostname || m.serial_num || '—'

  const handleDelete = async () => {
    if (!window.confirm('Delete this session and all its files?')) return
    setDeleting(true)
    try {
      await deleteSession(m.session_id)
      onDeleted?.()
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 12px', background: '#ffffff', border: '1px solid #f1f5f9', borderRadius: 4, flexWrap: 'wrap' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, color: '#334155', fontFamily: 'ui-monospace, Consolas, monospace', fontWeight: 500 }}>
          {nodeLabel}
          {m.model_name && (
            <span style={{ fontSize: 11, color: '#94a3b8', marginLeft: 8, fontFamily: 'system-ui, -apple-system, sans-serif', fontWeight: 500 }}>
              {m.model_name}
            </span>
          )}
        </div>
        <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 1 }}>
          {m.serial_num && m.hostname ? `${m.serial_num} · ` : ''}{m.original_filename} · {m.file_count} files · {fmtNode(m.generated_on)}
          <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 2 }}>
            Uploaded: {fmtUpload(m.uploaded_at || '')}
          </div>
        </div>
      </div>
      <Link
        to={`/viewer/${m.session_id}`}
        style={{ fontSize: 12, color: '#3b82f6', textDecoration: 'none', padding: '2px 8px', border: '1px solid rgba(59,130,246,0.25)', borderRadius: 4, background: 'rgba(59,130,246,0.06)', whiteSpace: 'nowrap' }}
      >
        Open →
      </Link>
      <button
        onClick={handleDelete}
        disabled={deleting}
        title="Delete session"
        style={{ background: 'none', border: 'none', color: deleting ? '#cbd5e1' : '#f87171', cursor: deleting ? 'wait' : 'pointer', fontSize: 13, padding: '0 2px' }}
      >
        🗑
      </button>
    </div>
  )
}

// A paired group row with its own expand/collapse
function GroupRow({ group, onDeleted }: { group: ClusterGroup; onDeleted?: () => void }) {
  const [expanded, setExpanded] = useState(false)
  const times = group.members
    .map((m) => m.generated_on)
    .filter(Boolean)
    .sort()
  const title = times.length === 0 ? '—' : times.length === 1
    ? fmtNode(times[0])
    : `${fmtPlain(times[0])} – ${fmtNode(times[times.length - 1])}`

  return (
    <div style={{ border: '1px solid #bfdbfe', borderRadius: 6, overflow: 'hidden', background: '#f0f9ff' }}>
      <div
        onClick={() => setExpanded((v) => !v)}
        style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px', cursor: 'pointer', userSelect: 'none' }}
      >
        <span style={{ color: '#3b82f6', fontSize: 11 }}>{expanded ? '▼' : '▶'}</span>
        <span style={{ fontSize: 13 }}>🔗</span>
        <span style={{ flex: 1, fontSize: 12, color: '#1e40af', fontFamily: 'ui-monospace, Consolas, monospace' }}>
          {title}
        </span>
        <Link
          to={`/viewer/group/${group.id}`}
          onClick={(e) => e.stopPropagation()}
          style={{ fontSize: 11, color: '#2563eb', textDecoration: 'none', background: 'rgba(37,99,235,0.1)', border: '1px solid rgba(37,99,235,0.3)', borderRadius: 4, padding: '2px 8px', whiteSpace: 'nowrap', fontWeight: 500 }}
        >
          Group View →
        </Link>
      </div>
      {expanded && (
        <div style={{ borderTop: '1px solid #bfdbfe', padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 4, background: '#f8fbff' }}>
          {group.members.map((m) => (
            <SessionRow key={m.session_id} m={m} onDeleted={onDeleted} />
          ))}
        </div>
      )}
    </div>
  )
}

export default function ClusterCard({ cluster, autoExpand = false, onDeleted }: ClusterCardProps) {
  const [expanded, setExpanded] = useState(false)
  const [overview, setOverview] = useState<ClusterOverview | null>(null)
  const [loadKey, setLoadKey] = useState(0)

  useEffect(() => {
    if (!autoExpand) return
    const timeoutId = window.setTimeout(() => setExpanded(true), 0)

    return () => window.clearTimeout(timeoutId)
  }, [autoExpand])

  useEffect(() => {
    if (!expanded) return
    getClusterOverview(cluster.id)
      .then((res) => setOverview(res.data))
      .catch(() => setOverview(null))
  }, [expanded, cluster.id, loadKey])

  const refresh = () => setLoadKey((k) => k + 1)

  const lastSeen = fmt(cluster.last_seen)
  const clusterTitle = cluster.cluster_name || cluster.id.slice(0, 8)

  return (
    <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'hidden', marginBottom: 12 }}>
      {/* Cluster header */}
      <div
        onClick={() => setExpanded((v) => !v)}
        style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', cursor: 'pointer', userSelect: 'none' }}
      >
        <span style={{ color: '#94a3b8', fontSize: 12 }}>{expanded ? '▼' : '▶'}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, color: '#1e293b', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {clusterTitle}
          </div>
          <div style={{ fontFamily: 'ui-monospace, Consolas, monospace', fontSize: 11, color: '#94a3b8', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            UUID: {cluster.id}
          </div>
          <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 1 }}>
            Last upload: {lastSeen}
          </div>
        </div>
        <span style={{ fontSize: 11, color: '#64748b', background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: 4, padding: '2px 8px', whiteSpace: 'nowrap' }}>
          {cluster.node_count} node{cluster.node_count !== 1 ? 's' : ''}
        </span>
      </div>

      {expanded && (
        <div style={{ borderTop: '1px solid #e2e8f0', padding: '10px 16px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {!overview ? (
            <div style={{ color: '#94a3b8', fontSize: 12 }}>Loading…</div>
          ) : (
            <>
              {/* Paired groups */}
              {overview.groups.map((g) => (
                <GroupRow key={g.id} group={g} onDeleted={() => { refresh(); onDeleted?.() }} />
              ))}

              {/* Ungrouped singles */}
              {overview.singles.map((m) => (
                <SessionRow key={m.session_id} m={m} onDeleted={() => { refresh(); onDeleted?.() }} />
              ))}

              {overview.groups.length === 0 && overview.singles.length === 0 && (
                <div style={{ color: '#94a3b8', fontSize: 12 }}>No sessions</div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
