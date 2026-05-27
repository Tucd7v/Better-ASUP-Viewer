import { useState } from 'react'
import type { FileRecord } from '../../types'
import { useViewer } from './ViewerContext'

interface FileTreeProps {
  onFocusFile: (fileId: string) => void
}

const TYPE_LABELS: Record<string, string> = {
  ems: 'EMS Logs',
  xml: 'XML',
  text: 'Text',
  unknown: 'Other',
}

const TYPE_ORDER = ['ems', 'xml', 'text', 'unknown']

export default function FileTree({ onFocusFile }: FileTreeProps) {
  const { state, dispatch } = useViewer()
  const [search, setSearch] = useState('')

  const filtered = search
    ? state.fileList.filter((f) =>
        f.filename.toLowerCase().includes(search.toLowerCase())
      )
    : state.fileList

  const grouped = TYPE_ORDER.reduce<Record<string, FileRecord[]>>((acc, type) => {
    const items = filtered.filter((f) => f.file_type === type)
    if (items.length > 0) acc[type] = items
    return acc
  }, {})

  const handleClick = (file: FileRecord) => {
    if (state.hiddenFileIds.has(file.id)) {
      dispatch({ type: 'SHOW_FILE', fileId: file.id })
    }
    onFocusFile(file.id)
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: '#13131f',
        borderRight: '1px solid #2a2a3e',
        overflow: 'hidden',
      }}
    >
      <div style={{ padding: '10px 12px', borderBottom: '1px solid #2a2a3e' }}>
        <input
          type="text"
          placeholder="Filter files…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            width: '100%',
            background: '#0f0f1a',
            border: '1px solid #2a2a3e',
            borderRadius: 4,
            color: '#e2e8f0',
            padding: '5px 8px',
            fontSize: 12,
            fontFamily: 'ui-monospace, Consolas, monospace',
            outline: 'none',
            boxSizing: 'border-box',
          }}
        />
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
        {Object.entries(grouped).map(([type, files]) => (
          <div key={type}>
            <div
              style={{
                padding: '4px 12px',
                fontSize: 10,
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: 1,
                color: '#475569',
              }}
            >
              {TYPE_LABELS[type] ?? type}
            </div>
            {files.map((file) => {
              const isHidden = state.hiddenFileIds.has(file.id)
              return (
                <div
                  key={file.id}
                  onClick={() => handleClick(file)}
                  style={{
                    padding: '5px 12px',
                    cursor: 'pointer',
                    fontSize: 12,
                    fontFamily: 'ui-monospace, Consolas, monospace',
                    color: isHidden ? '#475569' : '#cbd5e1',
                    background: 'transparent',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    transition: 'background 0.1s',
                  }}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.background = 'rgba(255,255,255,0.05)')
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.background = 'transparent')
                  }
                >
                  {isHidden && (
                    <span style={{ color: '#ef4444', fontSize: 10 }}>●</span>
                  )}
                  <span
                    style={{
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                    title={file.filename}
                  >
                    {file.filename}
                  </span>
                </div>
              )
            })}
          </div>
        ))}
        {state.fileList.length === 0 && (
          <div
            style={{ padding: '16px 12px', color: '#475569', fontSize: 12, textAlign: 'center' }}
          >
            No files
          </div>
        )}
      </div>
    </div>
  )
}
