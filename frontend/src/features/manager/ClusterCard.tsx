import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import type { Cluster, ClusterGroup, ClusterGroupMember, ClusterOverview } from '../../types'
import { getClusterOverview, deleteSession } from '../../services/api'

const colors = {
  textPrimary: '#1e293b',
  textSecondary: '#64748b',
  textTertiary: '#94a3b8',
  accent: '#3b82f6',
  accentLight: '#eff6ff',
  bgCard: '#ffffff',
  bgTertiary: '#f8fafc',
  border: 'rgba(0,0,0,0.05)',
  error: '#ef4444',
}

const systemFont = 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
const monoFont = 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace'

const cardStyle = {
  background: colors.bgCard,
  border: `1px solid ${colors.border}`,
  borderRadius: 16,
  boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
}

const actionLinkStyle = {
  alignItems: 'center',
  background: colors.accentLight,
  border: '1px solid rgba(59,130,246,0.16)',
  borderRadius: 8,
  color: colors.accent,
  display: 'inline-flex',
  fontSize: 12,
  fontWeight: 650,
  height: 30,
  padding: '0 10px',
  textDecoration: 'none',
  whiteSpace: 'nowrap' as const,
}

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
  const captureTime = fmtNode(m.generated_on) || 'No capture time'
  const uploadTime = fmtUpload(m.uploaded_at || '') || 'No upload time'

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
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) auto auto',
        alignItems: 'center',
        gap: 12,
        padding: '10px 12px',
        background: colors.bgCard,
        border: `1px solid ${colors.border}`,
        borderRadius: 10,
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            alignItems: 'baseline',
            display: 'flex',
            gap: 8,
            minWidth: 0,
          }}
        >
          <span
            style={{
              color: colors.textPrimary,
              fontSize: 13,
              fontWeight: 650,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {m.original_filename}
          </span>
          <span style={{ color: colors.textTertiary, flex: '0 0 auto', fontSize: 12 }}>
            {m.file_count} files
          </span>
        </div>
        <div style={{ color: colors.textSecondary, fontSize: 12, marginTop: 4 }}>
          {nodeLabel}
          {m.model_name ? ` · ${m.model_name}` : ''}
          {m.serial_num && m.hostname ? ` · ${m.serial_num}` : ''}
        </div>
        <div
          style={{
            color: colors.textTertiary,
            display: 'flex',
            flexWrap: 'wrap',
            fontSize: 11,
            gap: '4px 12px',
            marginTop: 4,
          }}
        >
          <div>
            Capture: {captureTime}
          </div>
          <div>
            Uploaded: {uploadTime}
          </div>
        </div>
      </div>
      <Link
        to={`/viewer/${m.session_id}`}
        style={actionLinkStyle}
      >
        Open
      </Link>
      <button
        onClick={handleDelete}
        disabled={deleting}
        title="Delete session"
        style={{
          background: colors.bgCard,
          border: `1px solid ${colors.border}`,
          borderRadius: 8,
          color: deleting ? colors.textTertiary : colors.error,
          cursor: deleting ? 'wait' : 'pointer',
          fontFamily: systemFont,
          fontSize: 12,
          fontWeight: 650,
          height: 30,
          padding: '0 10px',
        }}
      >
        {deleting ? 'Deleting' : 'Delete'}
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
    <div style={{ border: '1px solid rgba(59,130,246,0.16)', borderRadius: 12, overflow: 'hidden', background: colors.accentLight }}>
      <div
        onClick={() => setExpanded((v) => !v)}
        style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', cursor: 'pointer', userSelect: 'none' }}
      >
        <span style={{ color: colors.accent, fontSize: 11, width: 14 }}>{expanded ? '▼' : '▶'}</span>
        <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: colors.textPrimary, fontFamily: monoFont, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {title}
        </span>
        <Link
          to={`/viewer/group/${group.id}`}
          onClick={(e) => e.stopPropagation()}
          style={{ ...actionLinkStyle, height: 28 }}
        >
          Group View
        </Link>
      </div>
      {expanded && (
        <div style={{ borderTop: '1px solid rgba(59,130,246,0.16)', padding: 10, display: 'flex', flexDirection: 'column', gap: 6, background: colors.bgCard }}>
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
    <div style={{ ...cardStyle, overflow: 'hidden' }}>
      <div
        onClick={() => setExpanded((v) => !v)}
        style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '18px 20px', cursor: 'pointer', userSelect: 'none' }}
      >
        <span style={{ color: colors.textTertiary, fontSize: 13, width: 16 }}>{expanded ? '▼' : '▶'}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 18, color: colors.textPrimary, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {clusterTitle}
          </div>
          <div style={{ fontFamily: monoFont, fontSize: 11, color: colors.textTertiary, marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            UUID: {cluster.id}
          </div>
          <div style={{ fontSize: 12, color: colors.textSecondary, marginTop: 6 }}>
            Last upload: {lastSeen}
          </div>
        </div>
        <span style={{ fontSize: 12, color: colors.textSecondary, background: colors.bgTertiary, border: `1px solid ${colors.border}`, borderRadius: 8, padding: '5px 10px', whiteSpace: 'nowrap' }}>
          {cluster.node_count} node{cluster.node_count !== 1 ? 's' : ''}
        </span>
      </div>

      {expanded && (
        <div style={{ borderTop: `1px solid ${colors.border}`, padding: '14px 20px 18px', display: 'flex', flexDirection: 'column', gap: 10, background: colors.bgTertiary }}>
          {cluster.nodes.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {cluster.nodes.map((node) => (
                <div
                  key={node.id}
                  style={{
                    alignItems: 'center',
                    background: colors.bgCard,
                    border: `1px solid ${colors.border}`,
                    borderRadius: 10,
                    display: 'grid',
                    gap: 10,
                    gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
                    padding: '9px 12px',
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ color: colors.textTertiary, fontSize: 11 }}>Hostname</div>
                    <div style={{ color: colors.textPrimary, fontSize: 13, fontWeight: 650, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {node.hostname || '—'}
                    </div>
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ color: colors.textTertiary, fontSize: 11 }}>Model</div>
                    <div style={{ color: colors.textSecondary, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {node.model_name || '—'}
                    </div>
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ color: colors.textTertiary, fontSize: 11 }}>Serial</div>
                    <div style={{ color: colors.textSecondary, fontFamily: monoFont, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {node.serial_num || '—'}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {!overview ? (
            <div style={{ color: colors.textTertiary, fontSize: 12, padding: '4px 0' }}>Loading…</div>
          ) : (
            <>
              {overview.groups.map((g) => (
                <GroupRow key={g.id} group={g} onDeleted={() => { refresh(); onDeleted?.() }} />
              ))}

              {overview.singles.map((m) => (
                <SessionRow key={m.session_id} m={m} onDeleted={() => { refresh(); onDeleted?.() }} />
              ))}

              {overview.groups.length === 0 && overview.singles.length === 0 && (
                <div style={{ color: colors.textTertiary, fontSize: 12, padding: '4px 0' }}>No sessions</div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
