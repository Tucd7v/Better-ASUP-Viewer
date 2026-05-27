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

  useEffect(() => {
    const t = setTimeout(() => {
      setLoading(true)
      getClusters(search || undefined)
        .then((res) => setClusters(res.data ?? []))
        .catch(() => setClusters([]))
        .finally(() => setLoading(false))
    }, 300)
    return () => clearTimeout(t)
  }, [search])

  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#0f0f1a',
        color: '#e2e8f0',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '16px 24px',
          borderBottom: '1px solid #2a2a3e',
          background: '#13131f',
        }}
      >
        <h1
          style={{
            margin: 0,
            fontSize: 20,
            fontWeight: 700,
            color: '#e2e8f0',
            letterSpacing: '-0.3px',
          }}
        >
          ASUP Log Analyzer
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
            background: '#1e1e2e',
            border: '1px solid #2a2a3e',
            borderRadius: 6,
            color: '#e2e8f0',
            padding: '10px 14px',
            fontSize: 14,
            outline: 'none',
            marginBottom: 20,
            boxSizing: 'border-box',
          }}
        />

        {loading && (
          <div style={{ color: '#475569', fontSize: 14, textAlign: 'center', padding: '20px 0' }}>
            Loading…
          </div>
        )}

        {!loading && clusters.length === 0 && (
          <div
            style={{
              textAlign: 'center',
              padding: '60px 20px',
              color: '#475569',
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
            <ClusterCard key={cluster.id} cluster={cluster} />
          ))}
      </div>

      {showUpload && <UploadDialog onClose={() => setShowUpload(false)} />}
    </div>
  )
}
