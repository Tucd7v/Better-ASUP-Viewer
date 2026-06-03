import { useEffect, useMemo, useState } from 'react'
import { getClusters } from '../../services/api'
import type { Cluster } from '../../types'
import ClusterCard from './ClusterCard'
import UploadDialog from './UploadDialog'

const MS_PER_DAY = 86400000

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
  const [clusters, setClusters] = useState<Cluster[]>([])
  const [search, setSearch] = useState('')
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
            node.serial_num.toLowerCase().includes(q)
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
          node.serial_num.toLowerCase().includes(q)
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
        minHeight: '100vh',
        background: '#f1f5f9',
        color: '#1e293b',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '16px 24px',
          borderBottom: '1px solid #e2e8f0',
          background: '#ffffff',
        }}
      >
        <h1
          style={{
            margin: 0,
            fontSize: 20,
            fontWeight: 700,
            color: '#1e293b',
            letterSpacing: '-0.3px',
          }}
        >
          AiSUP
        </h1>
        <button
          onClick={() => setShowUpload(true)}
          style={{
            background: '#3b82f6',
            border: 'none',
            borderRadius: 6,
            color: '#fff',
            cursor: 'pointer',
            fontSize: 14,
            fontWeight: 600,
            padding: '8px 18px',
          }}
        >
          Upload File
        </button>
      </header>

      <div style={{ maxWidth: 900, margin: '0 auto', padding: '24px 20px' }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 20, flexWrap: 'wrap' }}>
          <input
            type="text"
            placeholder="Search cluster ID, hostname, serial number…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              flex: '1 1 320px',
              minWidth: 0,
              background: '#ffffff',
              border: '1px solid #e2e8f0',
              borderRadius: 6,
              color: '#1e293b',
              padding: '10px 14px',
              fontSize: 14,
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#64748b', fontSize: 13 }}>
            From
            <input
              type="date"
              value={fromDate}
              onChange={(e) => {
                setFromDate(e.target.value)
                setOnlyToday(false)
              }}
              style={{
                background: '#ffffff',
                border: '1px solid #e2e8f0',
                borderRadius: 6,
                color: '#1e293b',
                fontSize: 14,
                outline: 'none',
                padding: '9px 10px',
              }}
            />
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#64748b', fontSize: 13 }}>
            To
            <input
              type="date"
              value={toDate}
              onChange={(e) => {
                setToDate(e.target.value)
                setOnlyToday(false)
              }}
              style={{
                background: '#ffffff',
                border: '1px solid #e2e8f0',
                borderRadius: 6,
                color: '#1e293b',
                fontSize: 14,
                outline: 'none',
                padding: '9px 10px',
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
              background: onlyToday ? '#1d4ed8' : '#ffffff',
              border: onlyToday ? '1px solid #1d4ed8' : '1px solid #e2e8f0',
              borderRadius: 6,
              color: onlyToday ? '#ffffff' : '#1e293b',
              cursor: 'pointer',
              fontSize: 14,
              fontWeight: 600,
              padding: '10px 14px',
              whiteSpace: 'nowrap',
            }}
          >
            Only show Today
          </button>
        </div>

        {loading && (
          <div style={{ color: '#94a3b8', fontSize: 14, textAlign: 'center', padding: '20px 0' }}>
            Loading…
          </div>
        )}

        {!loading && filtered.length === 0 && (
          <div
            style={{
              textAlign: 'center',
              padding: '60px 20px',
              color: '#94a3b8',
            }}
          >
            <div style={{ fontSize: 48, marginBottom: 16 }}>📂</div>
            <div style={{ fontSize: 16, color: '#64748b', marginBottom: 8 }}>
              No ASUP logs yet.
            </div>
            <div style={{ fontSize: 14 }}>Click Upload to get started.</div>
          </div>
        )}

        {!loading &&
          filtered.map((cluster) => (
            <ClusterCard
              key={cluster.id}
              cluster={cluster}
              autoExpand={matchedClusterIds.has(cluster.id)}
              onDeleted={refreshClusters}
            />
          ))}
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
