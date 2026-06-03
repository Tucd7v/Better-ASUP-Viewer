import { useEffect, useState } from 'react'
import { getClusters } from '../../services/api'
import type { Cluster } from '../../types'
import ClusterCard from './ClusterCard'
import UploadDialog from './UploadDialog'

export default function ManagerPage() {
  const [clusters, setClusters] = useState<Cluster[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [showUpload, setShowUpload] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    const t = setTimeout(() => {
      setLoading(true)
      getClusters(search || undefined)
        .then((res) => setClusters(res.data?.clusters ?? []))
        .catch(() => setClusters([]))
        .finally(() => setLoading(false))
    }, 300)
    return () => clearTimeout(t)
  }, [search, refreshKey])

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
        <input
          type="text"
          placeholder="Search clusters…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            width: '100%',
            background: '#ffffff',
            border: '1px solid #e2e8f0',
            borderRadius: 6,
            color: '#1e293b',
            padding: '10px 14px',
            fontSize: 14,
            outline: 'none',
            marginBottom: 20,
            boxSizing: 'border-box',
          }}
        />

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

        {!loading &&
          clusters.map((cluster) => (
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
