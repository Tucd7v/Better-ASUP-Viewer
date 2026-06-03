import { useEffect, useMemo, useState } from 'react'
import { getClusters } from '../../services/api'
import type { Cluster } from '../../types'
import ClusterCard from './ClusterCard'
import UploadDialog from './UploadDialog'

type SearchScope = 'cluster' | 'node'
type TimeFilter = 'today' | '7d' | '30d' | 'all'

function parseDate(iso: string | null | undefined): Date | null {
  if (!iso) return null
  const d = new Date(iso.endsWith('Z') ? iso : `${iso}Z`)
  return Number.isNaN(d.getTime()) ? null : d
}

function isSameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

function matchesTimeFilter(cluster: Cluster, filter: TimeFilter): boolean {
  if (filter === 'all') return true
  const lastSeen = parseDate(cluster.last_seen)
  if (!lastSeen) return false

  const now = new Date()
  if (filter === 'today') return isSameLocalDay(lastSeen, now)

  const days = filter === '7d' ? 7 : 30
  return now.getTime() - lastSeen.getTime() <= days * 24 * 60 * 60 * 1000
}

export default function ManagerPage() {
  const [clusters, setClusters] = useState<Cluster[]>([])
  const [search, setSearch] = useState('')
  const [searchScope, setSearchScope] = useState<SearchScope>('cluster')
  const [timeFilter, setTimeFilter] = useState<TimeFilter>('all')
  const [loading, setLoading] = useState(false)
  const [showUpload, setShowUpload] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    const t = setTimeout(() => {
      setLoading(true)
      getClusters()
        .then((res) => setClusters(res.data?.clusters ?? []))
        .catch(() => setClusters([]))
        .finally(() => setLoading(false))
    }, 300)
    return () => clearTimeout(t)
  }, [refreshKey])

  const filteredClusters = useMemo(() => {
    const q = search.trim().toLowerCase()

    return clusters.filter((cluster) => {
      if (!matchesTimeFilter(cluster, timeFilter)) return false
      if (!q) return true

      if (searchScope === 'cluster') {
        return cluster.id.toLowerCase().includes(q)
      }

      return cluster.nodes.some((node) =>
        [node.hostname, node.id, node.serial_num]
          .filter(Boolean)
          .some((value) => value.toLowerCase().includes(q))
      )
    })
  }, [clusters, search, searchScope, timeFilter])

  const hasFilters = search.trim().length > 0 || timeFilter !== 'all'

  return (
    <div className="manager-page">
      <header className="manager-header">
        <h1>AiSUP</h1>
        <button
          className="manager-upload-button"
          onClick={() => setShowUpload(true)}
        >
          Upload File
        </button>
      </header>

      <main className="manager-shell">
        <div className="manager-toolbar" aria-label="Manager filters">
          <div className="manager-search">
            <select
              aria-label="Search by"
              value={searchScope}
              onChange={(e) => setSearchScope(e.target.value as SearchScope)}
            >
              <option value="cluster">Cluster</option>
              <option value="node">Node</option>
            </select>
            <input
              type="text"
              placeholder={searchScope === 'cluster' ? 'Search clusters' : 'Search node hostnames'}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <select
            className="manager-time-filter"
            aria-label="Time filter"
            value={timeFilter}
            onChange={(e) => setTimeFilter(e.target.value as TimeFilter)}
          >
            <option value="today">Today</option>
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
            <option value="all">All</option>
          </select>
        </div>

        {loading && (
          <div className="manager-loading">
            Loading…
          </div>
        )}

        {!loading && filteredClusters.length === 0 && (
          <div className="manager-empty">
            <div className="manager-empty-title">
              {hasFilters ? 'No matching ASUP logs.' : 'No ASUP logs yet.'}
            </div>
            <div className="manager-empty-copy">
              {hasFilters ? 'Adjust the search or time filter.' : 'Click Upload to get started.'}
            </div>
          </div>
        )}

        {!loading && filteredClusters.length > 0 && (
          <div className="manager-table-wrap">
            <table className="manager-table">
              <thead>
                <tr>
                  <th scope="col">Cluster</th>
                  <th scope="col">Time</th>
                  <th scope="col">Nodes</th>
                  <th scope="col">Logs</th>
                </tr>
              </thead>
              <tbody>
                {filteredClusters.map((cluster) => (
                  <ClusterCard
                    key={cluster.id}
                    cluster={cluster}
                    onDeleted={() => setRefreshKey((k) => k + 1)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>

      {showUpload && (
        <UploadDialog
          onClose={() => setShowUpload(false)}
          onDone={() => setRefreshKey((k) => k + 1)}
        />
      )}
    </div>
  )
}
