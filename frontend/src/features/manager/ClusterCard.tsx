import { Fragment, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { Cluster, ClusterGroup, ClusterGroupMember, ClusterOverview } from '../../types'
import { deleteSession, getClusterOverview } from '../../services/api'

interface ClusterCardProps {
  cluster: Cluster
  onDeleted?: () => void
}

type DateParts = {
  date: string
  time: string
  label: string
}

function parseDate(iso: string | null | undefined): Date | null {
  if (!iso) return null
  const d = new Date(iso.endsWith('Z') ? iso : `${iso}Z`)
  return Number.isNaN(d.getTime()) ? null : d
}

function fmt(iso: string | null | undefined): string {
  const d = parseDate(iso)
  if (!d) return iso || '—'
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

function dateParts(iso: string | null | undefined): DateParts {
  const label = fmt(iso)
  if (label === '—') return { date: '—', time: '', label }
  const [date, time = ''] = label.split(' ')
  return { date, time: time.slice(0, 5), label }
}

function isLast24Hours(iso: string | null | undefined): boolean {
  const d = parseDate(iso)
  if (!d) return false
  return Date.now() - d.getTime() <= 24 * 60 * 60 * 1000
}

function groupFileCount(group: ClusterGroup): number {
  return group.members.reduce((sum, m) => sum + (m.file_count || 0), 0)
}

function overviewFilesLast24h(overview: ClusterOverview | null): number | null {
  if (!overview) return null
  const grouped = overview.groups.flatMap((group) => group.members)
  const members = [...grouped, ...overview.singles]

  return members.reduce((sum, member) => {
    if (!isLast24Hours(member.generated_on)) return sum
    return sum + (member.file_count || 0)
  }, 0)
}

function clusterFilesLast24h(cluster: Cluster, overview: ClusterOverview | null): number | null {
  const explicit = cluster.files_last_24h ?? cluster.file_count_24h
  if (typeof explicit === 'number') return explicit

  const fromOverview = overviewFilesLast24h(overview)
  if (typeof fromOverview === 'number') return fromOverview

  const nodesWithCounts = cluster.nodes.filter((node) => typeof node.file_count === 'number')
  if (nodesWithCounts.length === 0) return null

  return nodesWithCounts.reduce((sum, node) => {
    const nodeTime = node.uploaded_at ?? node.last_seen ?? cluster.last_seen
    if (!isLast24Hours(nodeTime)) return sum
    return sum + (node.file_count || 0)
  }, 0)
}

function nodeLabel(member: ClusterGroupMember): string {
  return member.hostname || member.serial_num || 'Unknown node'
}

function SessionLine({ member, onDeleted }: { member: ClusterGroupMember; onDeleted?: () => void }) {
  const [deleting, setDeleting] = useState(false)

  const handleDelete = async () => {
    if (!window.confirm('Delete this session and all its files?')) return
    setDeleting(true)
    try {
      await deleteSession(member.session_id)
      onDeleted?.()
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="manager-session-line">
      <div className="manager-session-main">
        <span className="manager-node-name" title={nodeLabel(member)}>
          {nodeLabel(member)}
        </span>
        {member.serial_num && member.serial_num !== member.hostname && (
          <span className="manager-node-serial" title={member.serial_num}>
            {member.serial_num}
          </span>
        )}
        <span className="manager-file-badge" title={`${member.file_count} files`}>
          {member.file_count}
        </span>
      </div>
      <div className="manager-session-meta" title={member.original_filename}>
        {fmt(member.generated_on)} · {member.original_filename || 'ASUP session'}
      </div>
      <div className="manager-session-actions">
        <Link to={`/viewer/${member.session_id}`} title="Open session">
          Open
        </Link>
        <button
          type="button"
          onClick={handleDelete}
          disabled={deleting}
          title="Delete session"
        >
          Delete
        </button>
      </div>
    </div>
  )
}

function GroupRow({ group, onDeleted }: { group: ClusterGroup; onDeleted?: () => void }) {
  const [expanded, setExpanded] = useState(true)

  return (
    <div className="manager-ha-group">
      <div className="manager-ha-heading">
        <button type="button" onClick={() => setExpanded((v) => !v)}>
          <span className="manager-caret">{expanded ? '▼' : '▶'}</span>
          <span>HA pair</span>
          <span className="manager-file-badge">{groupFileCount(group)}</span>
        </button>
        <Link
          to={`/viewer/group/${group.id}`}
          title="Open grouped view"
        >
          Group View
        </Link>
      </div>
      {expanded && (
        <div className="manager-ha-members">
          {group.members.map((member) => (
            <SessionLine key={member.session_id} member={member} onDeleted={onDeleted} />
          ))}
        </div>
      )}
    </div>
  )
}

function ClusterNodeList({ cluster }: { cluster: Cluster }) {
  if (cluster.nodes.length === 0) {
    return <span className="manager-muted">No nodes</span>
  }

  return (
    <div className="manager-node-summary-list">
      {cluster.nodes.map((node) => {
        const count = node.file_count ?? node.session_count
        const label = node.hostname || node.id

        return (
          <div key={node.id} className="manager-node-summary">
            <span className="manager-node-name" title={label}>
              {label}
            </span>
            <span className="manager-file-badge" title={node.file_count == null ? `${count} sessions` : `${count} files`}>
              {count}
            </span>
          </div>
        )
      })}
    </div>
  )
}

function ExpandedNodeList({
  overview,
  loading,
  onDeleted,
}: {
  overview: ClusterOverview | null
  loading: boolean
  onDeleted?: () => void
}) {
  if (loading) return <span className="manager-muted">Loading nodes…</span>
  if (!overview) return <span className="manager-muted">Unable to load nodes</span>

  const hasRows = overview.groups.length > 0 || overview.singles.length > 0
  if (!hasRows) return <span className="manager-muted">No sessions</span>

  return (
    <div className="manager-expanded-nodes">
      {overview.groups.map((group) => (
        <GroupRow key={group.id} group={group} onDeleted={onDeleted} />
      ))}
      {overview.singles.map((member) => (
        <SessionLine key={member.session_id} member={member} onDeleted={onDeleted} />
      ))}
    </div>
  )
}

export default function ClusterCard({ cluster, onDeleted }: ClusterCardProps) {
  const [expanded, setExpanded] = useState(false)
  const [overview, setOverview] = useState<ClusterOverview | null>(null)
  const [loadingOverview, setLoadingOverview] = useState(false)
  const [loadKey, setLoadKey] = useState(0)

  useEffect(() => {
    if (!expanded) return

    let cancelled = false
    setLoadingOverview(true)
    getClusterOverview(cluster.id)
      .then((res) => {
        if (!cancelled) setOverview(res.data)
      })
      .catch(() => {
        if (!cancelled) setOverview(null)
      })
      .finally(() => {
        if (!cancelled) setLoadingOverview(false)
      })

    return () => {
      cancelled = true
    }
  }, [expanded, cluster.id, loadKey])

  const refresh = () => {
    setLoadKey((k) => k + 1)
    onDeleted?.()
  }

  const latest = dateParts(cluster.last_seen)
  const filesLast24h = useMemo(() => clusterFilesLast24h(cluster, overview), [cluster, overview])

  return (
    <Fragment>
      <tr className={expanded ? 'manager-cluster-row is-expanded' : 'manager-cluster-row'}>
        <td>
          <button
            type="button"
            className="manager-cluster-toggle"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
          >
            <span className="manager-caret">{expanded ? '▼' : '▶'}</span>
            <span className="manager-cluster-name" title={cluster.id}>
              {cluster.id}
            </span>
          </button>
        </td>
        <td>
          <time className="manager-time" dateTime={cluster.last_seen} title={latest.label}>
            <span>{latest.date}</span>
            {latest.time && <span>{latest.time}</span>}
          </time>
        </td>
        <td>
          {expanded ? (
            <ExpandedNodeList overview={overview} loading={loadingOverview} onDeleted={refresh} />
          ) : (
            <ClusterNodeList cluster={cluster} />
          )}
        </td>
        <td>
          <div className="manager-log-count">
            <span>{filesLast24h == null ? '—' : filesLast24h} files</span>
            <span>last 24h</span>
          </div>
        </td>
      </tr>
    </Fragment>
  )
}
