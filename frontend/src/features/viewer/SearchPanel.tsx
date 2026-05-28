import { useState } from 'react'
import { searchFiles } from '../../services/api'
import type { SearchMatch } from '../../types'
import { useViewer } from './ViewerContext'

interface SearchPanelProps {
  sessions: { id: string; color: 'blue' | 'orange' }[]
  onFocusFile: (fileId: string) => void
}

export default function SearchPanel({ sessions, onFocusFile }: SearchPanelProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchMatch[]>([])
  const [searching, setSearching] = useState(false)
  const { state, dispatch } = useViewer()

  const handleSearch = async () => {
    if (!query.trim()) return
    setSearching(true)
    const all: SearchMatch[] = []
    for (const s of sessions) {
      try {
        const res = await searchFiles(s.id, query.trim(), 50)
        const matches: SearchMatch[] = res.data?.matches ?? []
        matches.forEach((m) => { (m as any).nodeColor = s.color })
        all.push(...matches)
      } catch { /* skip failed sessions */ }
    }
    setResults(all)
    setSearching(false)
  }

  const handleClickResult = (match: SearchMatch) => {
    const fileId = match.file_id
    const isHidden = state.hiddenFileIds.has(fileId)
    if (isHidden) {
      dispatch({ type: 'SHOW_FILE', fileId })
    }
    onFocusFile(fileId)
    dispatch({
      type: 'SET_GLOBAL_SEARCH',
      fileId,
      query: query.trim(),
      line: match.line,
    })
  }

  const grouped = results.reduce<Record<string, SearchMatch[]>>((acc, m) => {
    const key = m.filename
    if (!acc[key]) acc[key] = []
    acc[key].push(m)
    return acc
  }, {})

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: '8px 10px', borderBottom: '1px solid #e2e8f0' }}>
        <div style={{ display: 'flex', gap: 4 }}>
          <input
            type="text"
            placeholder="Search logs..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleSearch() }}
            style={{
              flex: 1, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 4,
              color: '#1e293b', padding: '4px 8px', fontSize: 12,
              fontFamily: 'ui-monospace, Consolas, monospace', outline: 'none',
            }}
          />
          <button
            onClick={handleSearch}
            disabled={searching}
            style={{
              background: '#3b82f6', border: 'none', borderRadius: 4, color: '#fff',
              cursor: 'pointer', padding: '4px 10px', fontSize: 11, fontWeight: 500,
              fontFamily: 'ui-monospace, Consolas, monospace',
            }}
          >
            {searching ? '...' : 'Search'}
          </button>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {Object.entries(grouped).map(([filename, matches]) => (
          <div key={filename} style={{ borderBottom: '1px solid #f1f5f9' }}>
            <div style={{
              padding: '4px 10px', background: '#f8fafc',
              fontSize: 11, color: '#475569', fontWeight: 600,
              fontFamily: 'ui-monospace, Consolas, monospace',
              display: 'flex', alignItems: 'center', gap: 4,
            }}>
              {matches[0].file_type === 'ems' ? '\uD83D\uDEA8' : matches[0].file_type === 'xml' ? '\u25A7' : '\u2261'}
              {filename}
              <span style={{ color: '#94a3b8', fontWeight: 400 }}>({matches.length})</span>
            </div>
            {matches.slice(0, 20).map((m, i) => (
              <div
                key={i}
                onClick={() => handleClickResult(m)}
                style={{
                  padding: '3px 10px 3px 18px', cursor: 'pointer',
                  fontSize: 11, color: '#334155', lineHeight: 1.5,
                  fontFamily: 'ui-monospace, Consolas, monospace',
                  borderBottom: '1px solid #f8fafc',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = '#eff6ff')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                title={`Line ${m.line}`}
              >
                <span style={{ color: '#94a3b8', marginRight: 6 }}>L{m.line}</span>
                <span>{m.context}</span>
              </div>
            ))}
          </div>
        ))}
        {results.length === 0 && query && !searching && (
          <div style={{ padding: '20px 10px', textAlign: 'center', color: '#94a3b8', fontSize: 12 }}>
            No results
          </div>
        )}
      </div>
    </div>
  )
}
