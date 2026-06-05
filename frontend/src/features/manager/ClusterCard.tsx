import type { CSSProperties } from 'react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import type { Cluster, ClusterGroup, ClusterGroupMember, ClusterOverview } from '../../types'
import { deleteSession, getClusterOverview } from '../../services/api'

const colors = {
  textPrimary: '#1e293b',
  textSecondary: '#64748b',
  textTertiary: '#94a3b8',
  accent: '#3b82f6',
  accentLight: '#eff6ff',
  bgPrimary: '#f8fafc',
  border: 'rgba(0,0,0,0.05)',
  glass: 'rgba(255,255,255,0.8)',
  blueBorder: 'rgba(191,219,254,0.5)',
  error: '#ef4444',
}

const systemFont = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Helvetica Neue", Arial, sans-serif'
const monoFont = '"SF Mono", "Fira Code", "Fira Mono", Menlo, Consolas, monospace'

const glassCardStyle: CSSProperties = {
  background: colors.glass,
  backdropFilter: 'blur(12px)',
  WebkitBackdropFilter: 'blur(12px)',
  border: `1px solid ${colors.border}`,
  borderRadius: 16,
  overflow: 'hidden',
}

const actionStyle: CSSProperties = {
  alignItems: 'center',
  borderRadius: 8,
  display: 'inline-flex',
  fontFamily: systemFont,
  fontSize: 12,
  fontWeight: 500,
  height: 30,
  justifyContent: 'center',
  lineHeight: '16px',
  padding: '0 10px',
  textDecoration: 'none',
  whiteSpace: 'nowrap',
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
        alignItems: 'center',
        borderTop: `1px solid ${colors.border}`,
        display: 'grid',
        gap: 12,
        gridTemplateColumns: 'minmax(0, 1fr) auto auto',
        padding: '14px 0',
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            alignItems: 'center',
            display: 'flex',
            gap: 8,
            minWidth: 0,
          }}
        >
          <span
            style={{
              color: colors.textPrimary,
              fontSize: 14,
              fontWeight: 500,
              lineHeight: '20px',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {m.original_filename}
          </span>
          <span
            style={{
              color: colors.textTertiary,
              flex: '0 0 auto',
              fontSize: 12,
              lineHeight: '16px',
            }}
          >
            {m.file_count} files
          </span>
        </div>
        <div
          style={{
            color: colors.textSecondary,
            fontSize: 12,
            lineHeight: '16px',
            marginTop: 4,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {nodeLabel}
          {m.model_name ? ` · ${m.model_name}` : ''}
          {m.serial_num && m.hostname ? ` · ${m.serial_num}` : ''}
        </div>
        <div
          style={{
            color: colors.textTertiary,
            display: 'flex',
            flexWrap: 'wrap',
            fontSize: 12,
            gap: '4px 12px',
            lineHeight: '16px',
            marginTop: 4,
          }}
        >
          <span>Capture: {captureTime}</span>
          <span>Uploaded: {uploadTime}</span>
        </div>
      </div>
      <Link
        to={`/viewer/${m.session_id}`}
        style={{
          ...actionStyle,
          background: colors.accentLight,
          border: `1px solid ${colors.blueBorder}`,
          color: colors.accent,
        }}
      >
        Open
      </Link>
      <button
        onClick={handleDelete}
        disabled={deleting}
        title="Delete session"
        style={{
          ...actionStyle,
          background: '#ffffff',
          border: `1px solid ${colors.border}`,
          color: deleting ? colors.textTertiary : colors.error,
          cursor: deleting ? 'wait' : 'pointer',
        }}
      >
        {deleting ? 'Deleting' : 'Delete'}
      </button>
    </div>
  )
}

function GroupRow({ group, onDeleted }: { group: ClusterGroup; onDeleted?: () => void }) {
  const [expanded, setExpanded] = useState(false)
  const times = group.members
    .map((m) => m.generated_on)
    .filter(Boolean)
    .sort()
  const title = times.length === 0 ? '—' : times.length === 1
    ? fmtNode(times[0])
    : `${fmtPlain(times[0])} - ${fmtNode(times[times.length - 1])}`

  return (
    <div
      style={{
        borderTop: `1px solid ${colors.border}`,
        padding: '14px 0',
      }}
    >
      <div
        onClick={() => setExpanded((value) => !value)}
        style={{
          alignItems: 'center',
          cursor: 'pointer',
          display: 'grid',
          gap: 12,
          gridTemplateColumns: 'minmax(0, 1fr) auto',
          userSelect: 'none',
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              color: colors.textPrimary,
              fontFamily: monoFont,
              fontSize: 13,
              fontWeight: 500,
              lineHeight: '20px',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {title}
          </div>
          <div
            style={{
              color: colors.textTertiary,
              fontSize: 12,
              lineHeight: '16px',
              marginTop: 4,
            }}
          >
            {group.members.length} grouped sessions
          </div>
        </div>
        <Link
          to={`/viewer/group/${group.id}`}
          onClick={(event) => event.stopPropagation()}
          style={{
            ...actionStyle,
            background: colors.accentLight,
            border: `1px solid ${colors.blueBorder}`,
            color: colors.accent,
          }}
        >
          Group View
        </Link>
      </div>
      {expanded && (
        <div
          style={{
            marginTop: 10,
            paddingLeft: 12,
          }}
        >
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

    const timer = window.setTimeout(() => setExpanded(true), 0)
    return () => window.clearTimeout(timer)
  }, [autoExpand])

  useEffect(() => {
    if (!expanded) return
    getClusterOverview(cluster.id)
      .then((res) => setOverview(res.data))
      .catch(() => setOverview(null))
  }, [expanded, cluster.id, loadKey])

  const refresh = () => setLoadKey((key) => key + 1)
  const clusterTitle = cluster.cluster_name || cluster.id

  return (
    <div style={glassCardStyle}>
      <div
        onClick={() => setExpanded((value) => !value)}
        style={{
          alignItems: 'center',
          borderBottom: `1px solid ${colors.border}`,
          cursor: 'pointer',
          display: 'flex',
          gap: 12,
          justifyContent: 'space-between',
          padding: '16px 20px',
          userSelect: 'none',
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              color: colors.textPrimary,
              fontSize: 14,
              fontWeight: 600,
              lineHeight: '20px',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {clusterTitle}
          </div>
          <div
            style={{
              color: colors.textTertiary,
              fontFamily: monoFont,
              fontSize: 12,
              lineHeight: '16px',
              marginTop: 4,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            UUID: {cluster.id} · Last upload: {fmt(cluster.last_seen)}
          </div>
        </div>
        <span
          style={{
            alignItems: 'center',
            background: colors.accentLight,
            border: `1px solid ${colors.blueBorder}`,
            borderRadius: 999,
            color: colors.accent,
            display: 'inline-flex',
            flex: '0 0 auto',
            fontSize: 12,
            fontWeight: 500,
            lineHeight: '16px',
            padding: '4px 10px',
            whiteSpace: 'nowrap',
          }}
        >
          {cluster.node_count} node{cluster.node_count !== 1 ? 's' : ''}
        </span>
      </div>

      {expanded && (
        <div
          style={{
            padding: '16px 20px',
          }}
        >
          <div>
            <div
              style={{
                color: colors.textTertiary,
                fontSize: 12,
                fontWeight: 500,
                lineHeight: '16px',
                marginBottom: 2,
                textTransform: 'uppercase',
              }}
            >
              Sessions
            </div>

            {!overview ? (
              <div style={{ color: colors.textTertiary, fontSize: 12, lineHeight: '16px', padding: '14px 0' }}>
                Loading…
              </div>
            ) : (
              <>
                {overview.groups.map((group) => (
                  <GroupRow
                    key={group.id}
                    group={group}
                    onDeleted={() => {
                      refresh()
                      onDeleted?.()
                    }}
                  />
                ))}

                {overview.singles.map((member) => (
                  <SessionRow
                    key={member.session_id}
                    m={member}
                    onDeleted={() => {
                      refresh()
                      onDeleted?.()
                    }}
                  />
                ))}

                {overview.groups.length === 0 && overview.singles.length === 0 && (
                  <div style={{ color: colors.textTertiary, fontSize: 12, lineHeight: '16px', padding: '14px 0' }}>
                    No sessions
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
