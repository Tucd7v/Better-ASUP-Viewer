import { useEffect, useMemo, useState } from 'react'
import { getClusters } from '../../services/api'
import type { Cluster } from '../../types'
import ClusterCard from './ClusterCard'
import UploadDialog from './UploadDialog'

type TimeFilter = 'today' | '7d' | '30d' | 'all'

function inRange(iso: string | null, days: number): boolean {
  if (!iso) return false
  const d = new Date(iso.endsWith('Z') ? iso : iso + 'Z')
  if (isNaN(d.getTime())) return false
  return Date.now() - d.getTime() <= days * 86400000
}

export default function ManagerPage() {
  const [clusters, setClusters] = useState<Cluster[]>([])
  const [search, setSearch] = useState('')
  const [timeFilter, setTimeFilter] = useState<TimeFilter>('all')
  const [loading, setLoading] = useState(false)
  const [showUpload, setShowUpload] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    setLoading(true)
    getClusters()
      .then((res) => setClusters(res.data?.clusters ?? []))
      .catch(() => setClusters([]))
      .finally(() => setLoading(false))
  }, [refreshKey])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    let result = clusters
    // Time filter
    if (timeFilter === 'today') result = result.filter(c => inRange(c.last_seen, 1))
    else if (timeFilter === '7d') result = result.filter(c => inRange(c.last_seen, 7))
    else if (timeFilter === '30d') result = result.filter(c => inRange(c.last_seen, 30))
    // Search: cluster ID, node hostname, node SN
    if (q) result = result.filter(c =>
      c.id.toLowerCase().includes(q) ||
      c.nodes.some(n =>
        (n.hostname || '').toLowerCase().includes(q) ||
        (n.serial_num || '').toLowerCase().includes(q)
      )
    )
    return result
  }, [clusters, search, timeFilter])

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
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          <input type="text" placeholder="Search clusters / nodes / SN…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ flex: 1, background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 6, color: '#1e293b', padding: '10px 14px', fontSize: 14, outline: 'none', boxSizing: 'border-box' }} />
          <select value={timeFilter} onChange={(e) => setTimeFilter(e.target.value as TimeFilter)} style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 6, color: '#1e293b', fontSize: 13, padding: '0 10px', outline: 'none', cursor: 'pointer', fontWeight: timeFilter !== 'all' ? 600 : 400 }}>
            <option value="today">Today</option>
            <option value="7d">7 days</option>
            <option value="30d">30 days</option>
            <option value="all">All</option>
          </select>
        </div>

        {loading && (
          <div style={{ color: '#94a3b8', fontSize: 14, textAlign: 'center', padding: '20px 0' }}>
            Loading…
          </div>
        )}

        {!loading && clusters.length === 0 && (
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

        {!loading && filtered.map((cluster) => (
            <ClusterCard key={cluster.id} cluster={cluster} onDeleted={() => setRefreshKey((k) => k + 1)} />
          ))}
      </div>

      {showUpload && (
        <UploadDialog
          onClose={() => setShowUpload(false)}
          onDone={() => setRefreshKey((k) => k + 1)}
        />
      )}
    </div>
  )
}
