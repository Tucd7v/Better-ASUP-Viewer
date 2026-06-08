import type { CSSProperties } from 'react'
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
  bgPrimary: '#f8fafc',
  border: 'rgba(0,0,0,0.05)',
  glass: 'rgba(255,255,255,0.8)',
  blueBorder: 'rgba(191,219,254,0.5)',
}

const systemFont = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Helvetica Neue", Arial, sans-serif'

const glassStyle: CSSProperties = {
  background: colors.glass,
  backdropFilter: 'blur(12px)',
  WebkitBackdropFilter: 'blur(12px)',
}

const fieldStyle: CSSProperties = {
  background: '#ffffff',
  border: `1px solid ${colors.border}`,
  borderRadius: 10,
  color: colors.textPrimary,
  fontFamily: systemFont,
  fontSize: 14,
  height: 40,
  lineHeight: '20px',
  outline: 'none',
  padding: '0 12px',
}

const labelStyle: CSSProperties = {
  alignItems: 'center',
  color: colors.textSecondary,
  display: 'flex',
  fontSize: 12,
  fontWeight: 500,
  gap: 8,
  lineHeight: '16px',
  whiteSpace: 'nowrap',
}

const buttonStyle: CSSProperties = {
  borderRadius: 10,
  cursor: 'pointer',
  fontFamily: systemFont,
  fontSize: 14,
  fontWeight: 600,
  height: 40,
  lineHeight: '20px',
  padding: '0 16px',
  whiteSpace: 'nowrap',
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

function DatabaseIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="20"
      stroke="currentColor"
      viewBox="0 0 24 24"
      width="20"
      style={{ color: colors.accent, flex: '0 0 auto' }}
    >
      <path
        d="M4 7c0 1.657 3.582 3 8 3s8-1.343 8-3M4 7c0-1.657 3.582-3 8-3s8 1.343 8 3M4 7v10c0 1.657 3.582 3 8 3s8-1.343 8-3V7M4 12c0 1.657 3.582 3 8 3s8-1.343 8-3"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
      />
    </svg>
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
        (cluster.cluster_name || '').toLowerCase().includes(q) ||
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
        background: colors.bgPrimary,
        color: colors.textPrimary,
        display: 'flex',
        flexDirection: 'column',
        fontFamily: systemFont,
        height: '100vh',
        letterSpacing: 0,
        overflow: 'hidden',
      }}
    >
      <header
        style={{
          ...glassStyle,
          borderBottom: `1px solid ${colors.border}`,
          flexShrink: 0,
          left: 0,
          position: 'fixed',
          right: 0,
          top: 0,
          zIndex: 20,
        }}
      >
        <div
          style={{
            alignItems: 'center',
            display: 'flex',
            justifyContent: 'space-between',
            padding: '12px 20px',
          }}
        >
          <div style={{ alignItems: 'center', display: 'flex', gap: 12 }}>
            <div style={{ alignItems: 'center', display: 'flex', gap: 8 }}>
              <DatabaseIcon />
              <span
                style={{
                  color: colors.textPrimary,
                  fontSize: 16,
                  fontWeight: 600,
                  lineHeight: '24px',
                  letterSpacing: 0,
                }}
              >
                AiSUP Manager
              </span>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button onClick={() => setShowUpload(true)} style={{
              background: colors.accent, color: '#fff', border: 'none',
              borderRadius: 8, padding: '6px 14px', fontSize: 13,
              fontWeight: 600, cursor: 'pointer', fontFamily: systemFont,
            }}>
              Upload
            </button>
            <div style={{ color: colors.textTertiary, fontSize: 12, lineHeight: '16px' }}>
              DM ASUP Analysis Tool
            </div>
          </div>
        </div>
      </header>

      <main
        style={{
          flex: 1,
          overflow: 'hidden',
          paddingTop: 49,
        }}
      >
        <div
          style={{
            height: '100%',
            margin: '0 auto',
            maxWidth: 1200,
            overflowY: 'auto',
            padding: '24px 24px 32px',
          }}
        >
          <div style={{ marginBottom: 32 }}>
            <h2
              style={{
                color: colors.textPrimary,
                fontSize: 30,
                fontWeight: 700,
                letterSpacing: 0,
                lineHeight: '36px',
                margin: '0 0 4px',
              }}
            >
              AiSUP Manager
            </h2>
            <p
              style={{
                color: colors.textSecondary,
                fontSize: 16,
                lineHeight: '24px',
                margin: 0,
              }}
            >
              浏览、搜索和管理 NetApp DM ASUP 存储日志
            </p>
          </div>

          <div
            style={{
              ...glassStyle,
              border: `1px solid ${colors.border}`,
              borderRadius: 16,
              marginBottom: 24,
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                alignItems: 'center',
                borderTop: `1px solid ${colors.border}`,
                display: 'flex',
                flexWrap: 'wrap',
                gap: 12,
                padding: '16px 20px',
              }}
            >
              <input
                type="text"
                placeholder="Search cluster, hostname, SN…"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value)
                  setSearchParams(e.target.value ? { q: e.target.value } : {})
                }}
                style={{
                  ...fieldStyle,
                  flex: '1 1 260px',
                  minWidth: 0,
                }}
              />
              <label style={labelStyle}>
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
              <label style={labelStyle}>
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
                  ...buttonStyle,
                  background: onlyToday ? colors.accent : '#ffffff',
                  border: onlyToday ? `1px solid ${colors.accent}` : `1px solid ${colors.border}`,
                  color: onlyToday ? '#ffffff' : colors.textPrimary,
                }}
              >
                Show Today Upload
              </button>
            </div>
          </div>

          {loading && (
            <div
              style={{
                ...glassStyle,
                border: `1px solid ${colors.border}`,
                borderRadius: 16,
                color: colors.textTertiary,
                fontSize: 14,
                padding: '28px 0',
                textAlign: 'center',
              }}
            >
              Loading…
            </div>
          )}

          {!loading && filtered.length === 0 && (
            <div
              style={{
                ...glassStyle,
                border: `1px solid ${colors.border}`,
                borderRadius: 16,
                color: colors.textTertiary,
                fontSize: 14,
                padding: '56px 20px',
                textAlign: 'center',
              }}
            >
              No ASUP logs.
            </div>
          )}

          {!loading && filtered.length > 0 && (
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
      </main>
      {showUpload && <UploadDialog onClose={() => setShowUpload(false)} onDone={refreshClusters} />}
    </div>
  )
}
