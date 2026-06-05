import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { getClusters } from '../../services/api'
import type { Cluster } from '../../types'
import ClusterCard from './ClusterCard'
import UploadDialog from './UploadDialog'

const MS_PER_DAY = 86400000
const colors = {
  textPrimary: '#1e293b',
  textSecondary: '#64748b',
  textTertiary: '#94a3b8',
  accent: '#3b82f6',
  accentLight: '#eff6ff',
  bgCard: '#ffffff',
  bgTertiary: '#f8fafc',
  border: 'rgba(0,0,0,0.05)',
}

const cardStyle = {
  background: colors.bgCard,
  border: `1px solid ${colors.border}`,
  borderRadius: 16,
  boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
}

const buttonBaseStyle = {
  borderRadius: 10,
  cursor: 'pointer',
  fontSize: 14,
  fontWeight: 650,
  height: 40,
  padding: '0 16px',
  whiteSpace: 'nowrap' as const,
  fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
}

const fieldStyle = {
  background: colors.bgCard,
  border: `1px solid ${colors.border}`,
  borderRadius: 10,
  color: colors.textPrimary,
  fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  fontSize: 14,
  height: 40,
  outline: 'none',
  padding: '0 12px',
}

function parseUtc8(iso: string): number {
  const trimmed = iso.trim()
  if (!trimmed) return Number.NaN

  const withoutZone = trimmed
    .replace(' ', 'T')
    .replace(/(?:Z|[+-]\d{2}:?\d{2})$/i, '')
  const withTime = /^\d{4}-\d{2}-\d{2}$/.test(withoutZone)
    ? `${withoutZone}T00:00:00`
    : withoutZone

  return Date.parse(`${withTime}+08:00`)
}

function inRange(iso: string, days: number): boolean {
  const parsed = parseUtc8(iso)
  return Number.isFinite(parsed) && Date.now() - parsed <= days * MS_PER_DAY
}

function inDateRange(iso: string, fromDate: string, toDate: string): boolean {
  const parsed = parseUtc8(iso)
  const from = parseUtc8(fromDate)
  const to = parseUtc8(`${toDate}T23:59:59.999`)

  return (
    Number.isFinite(parsed) &&
    Number.isFinite(from) &&
    Number.isFinite(to) &&
    parsed >= from &&
    parsed <= to
  )
}

export default function ManagerPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [clusters, setClusters] = useState<Cluster[]>([])
  const [search, setSearch] = useState(searchParams.get('q') || '')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [onlyToday, setOnlyToday] = useState(false)
  const [loading, setLoading] = useState(true)
  const [showUpload, setShowUpload] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)

  const refreshClusters = () => {
    setLoading(true)
    setRefreshKey((k) => k + 1)
  }

  useEffect(() => {
    getClusters()
      .then((res) => setClusters(res.data?.clusters ?? []))
      .catch(() => setClusters([]))
      .finally(() => setLoading(false))
  }, [refreshKey])

  const matchedClusterIds = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return new Set<string>()

    return new Set(
      clusters
        .filter((cluster) =>
          cluster.nodes.some((node) =>
            node.hostname.toLowerCase().includes(q) ||
            node.serial_num.toLowerCase().includes(q) ||
            (node.model_name || '').toLowerCase().includes(q)
          )
        )
        .map((cluster) => cluster.id)
    )
  }, [clusters, search])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()

    return clusters.filter((cluster) => {
      const matchesSearch =
        !q ||
        cluster.id.toLowerCase().includes(q) ||
        cluster.nodes.some((node) =>
          node.hostname.toLowerCase().includes(q) ||
          node.serial_num.toLowerCase().includes(q) ||
          (node.model_name || '').toLowerCase().includes(q)
        )

      if (!matchesSearch) return false

      if (onlyToday) return inRange(cluster.last_seen, 1)
      if (fromDate && toDate) return inDateRange(cluster.last_seen, fromDate, toDate)

      return true
    })
  }, [clusters, search, onlyToday, fromDate, toDate])

  return (
    <div
      style={{
        height: '100vh',
        overflowY: 'auto',
        background: colors.bgTertiary,
        color: colors.textPrimary,
        fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      }}
    >
      <div style={{ maxWidth: 1080, margin: '0 auto', padding: '32px 24px 48px' }}>
        <section
          style={{
            ...cardStyle,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 20,
            marginBottom: 16,
            padding: '24px 28px',
            flexWrap: 'wrap',
          }}
        >
          <div style={{ minWidth: 240 }}>
            <h1
              style={{
                margin: 0,
                color: colors.textPrimary,
                fontSize: 30,
                fontWeight: 700,
                lineHeight: 1.2,
              }}
            >
              AiSUP Manager
            </h1>
            <p
              style={{
                margin: '8px 0 0',
                color: colors.textSecondary,
                fontSize: 15,
                lineHeight: 1.45,
              }}
            >
              浏览、搜索和管理存储日志
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <button
              onClick={() => setShowUpload(true)}
              style={{
                ...buttonBaseStyle,
                background: colors.accent,
                border: `1px solid ${colors.accent}`,
                color: '#ffffff',
              }}
            >
              Upload
            </button>
            <button
              onClick={() => refreshClusters()}
              style={{
                ...buttonBaseStyle,
                background: colors.accentLight,
                border: `1px solid rgba(59,130,246,0.16)`,
                color: colors.accent,
              }}
            >
              Storage management
            </button>
          </div>
        </section>

        <div
          style={{
            ...cardStyle,
            display: 'flex',
            gap: 12,
            alignItems: 'center',
            marginBottom: 16,
            padding: 14,
            flexWrap: 'wrap',
          }}
        >
          <input
            type="text"
            placeholder="Search cluster, hostname, SN…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setSearchParams(e.target.value ? { q: e.target.value } : {}) }}
            style={{
              ...fieldStyle,
              flex: '1 1 200px',
              minWidth: 0,
            }}
          />
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, color: colors.textSecondary, fontSize: 13, fontWeight: 600 }}>
            From
            <input
              type="date"
              value={fromDate}
              onChange={(e) => {
                setFromDate(e.target.value)
                setOnlyToday(false)
              }}
              style={{
                ...fieldStyle,
                width: 152,
              }}
            />
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, color: colors.textSecondary, fontSize: 13, fontWeight: 600 }}>
            To
            <input
              type="date"
              value={toDate}
              onChange={(e) => {
                setToDate(e.target.value)
                setOnlyToday(false)
              }}
              style={{
                ...fieldStyle,
                width: 152,
              }}
            />
          </label>
          <button
            onClick={() => {
              if (onlyToday) {
                setOnlyToday(false)
              } else {
                setFromDate('')
                setToDate('')
                setOnlyToday(true)
              }
            }}
            aria-pressed={onlyToday}
            style={{
              ...buttonBaseStyle,
              background: onlyToday ? colors.accent : colors.bgCard,
              border: onlyToday ? `1px solid ${colors.accent}` : `1px solid ${colors.border}`,
              color: onlyToday ? '#ffffff' : '#1e293b',
            }}
          >
            Show Today Upload
          </button>
        </div>

        {loading && (
          <div style={{ ...cardStyle, color: colors.textTertiary, fontSize: 14, textAlign: 'center', padding: '28px 0' }}>
            Loading…
          </div>
        )}

        {!loading && filtered.length === 0 && (
          <div
            style={{
              ...cardStyle,
              textAlign: 'center',
              padding: '56px 20px',
              color: colors.textTertiary,
            }}
          >
            <div style={{ fontSize: 40, marginBottom: 14 }}>📂</div>
            <div style={{ fontSize: 16, color: colors.textSecondary, marginBottom: 8, fontWeight: 650 }}>
              No ASUP logs yet.
            </div>
            <div style={{ fontSize: 14 }}>Click Upload to get started.</div>
          </div>
        )}

        {!loading &&
          filtered.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {filtered.map((cluster) => (
                <ClusterCard
                  key={cluster.id}
                  cluster={cluster}
                  autoExpand={matchedClusterIds.has(cluster.id)}
                  onDeleted={refreshClusters}
                />
              ))}
            </div>
          )}
      </div>

      {showUpload && (
        <UploadDialog
          onClose={() => setShowUpload(false)}
          onDone={refreshClusters}
        />
      )}
    </div>
  )
}
