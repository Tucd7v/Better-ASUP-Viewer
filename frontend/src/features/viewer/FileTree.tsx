import { useEffect, useMemo, useRef, useState } from 'react'
import type { FileRecord, SessionMeta } from '../../types'
import { useViewer } from './ViewerContext'

interface FileTreeProps {
  sessions: SessionMeta[]
  clusterName: string
  onFocusFile: (fileId: string) => void
}

const FILE_TYPE_ORDER = ['txt', 'xml', 'ems', 'other']

const FILE_TYPE_LABELS: Record<string, string> = {
  txt: 'TXT / TEXT',
  xml: 'XML',
  ems: 'EMS',
  other: 'OTHER',
}

export default function FileTree({ sessions, clusterName, onFocusFile }: FileTreeProps) {
  const { state, dispatch } = useViewer()
  const [fileSearch, setFileSearch] = useState('')
  const [expandedCluster, setExpandedCluster] = useState(true)
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set())
  const [expandedTypes, setExpandedTypes] = useState<Set<string>>(new Set())
  const isDragging = useRef(false)

  const normalizedFileSearch = fileSearch.trim().toLowerCase()

  const sessionRows = useMemo(() => {
    const known = sessions.length
      ? sessions
      : state.sessions.map((s, index) => ({
          ...s,
          hostname: index === 0 ? 'NodeA' : 'NodeB',
          partnerHostname: '',
        }))

    const fileSessionIds = new Set(
      state.fileList.map((file) => file.sessionId).filter(Boolean) as string[]
    )
    const missing = [...fileSessionIds]
      .filter((sessionId) => !known.some((s) => s.sessionId === sessionId))
      .map((sessionId, index) => {
        const fileColor = state.fileList.find((file) => file.sessionId === sessionId)?.nodeColor

        return {
          sessionId,
          serialNum: '',
          generatedOn: '',
          nodeColor: fileColor ?? '#3b82f6',
          hostname: index === 0 ? 'NodeA' : 'NodeB',
          partnerHostname: '',
        }
      })

    return [...known, ...missing]
  }, [sessions, state.fileList, state.sessions])

  const partnerHostnameKey = sessionRows
    .map((session) => session.partnerHostname ?? '')
    .join(',')

  const haPairSessionIds = useMemo(() => {
    if (!partnerHostnameKey) return new Set<string>()

    const byHostname = new Map<string, string>()
    sessionRows.forEach((session) => {
      const hostname = normalizeHostname(session.hostname)
      if (hostname) byHostname.set(hostname, session.sessionId)
    })

    const paired = new Set<string>()
    sessionRows.forEach((session) => {
      const partnerSessionId = byHostname.get(normalizeHostname(session.partnerHostname))
      if (partnerSessionId && partnerSessionId !== session.sessionId) {
        paired.add(session.sessionId)
        paired.add(partnerSessionId)
      }
    })
    return paired
  }, [sessionRows, partnerHostnameKey])

  const sortedSessionRows = useMemo(() => {
    const result: typeof sessionRows = []
    const used = new Set<string>()

    for (const session of sessionRows) {
      if (used.has(session.sessionId)) continue

      result.push(session)
      used.add(session.sessionId)

      if (!haPairSessionIds.has(session.sessionId)) continue

      const hostname = normalizeHostname(session.hostname)
      const partnerName = normalizeHostname(session.partnerHostname)
      if (!hostname && !partnerName) continue

      const partner = sessionRows.find(
        (candidate) =>
          candidate.sessionId !== session.sessionId &&
          (
            normalizeHostname(candidate.hostname) === partnerName ||
            normalizeHostname(candidate.partnerHostname) === hostname
          ) &&
          !used.has(candidate.sessionId)
      )
      if (partner) {
        result.push(partner)
        used.add(partner.sessionId)
      }
    }

    return result
  }, [sessionRows, haPairSessionIds])

  const groupedFiles = useMemo(() => {
    const bySession = new Map<string, Map<string, FileRecord[]>>()
    state.fileList.forEach((file) => {
      if (
        normalizedFileSearch &&
        !file.filename.toLowerCase().includes(normalizedFileSearch)
      ) {
        return
      }

      const sessionId = file.sessionId ?? 'unknown'
      const fileType = getFileGroup(file)
      const sessionMap = bySession.get(sessionId) ?? new Map<string, FileRecord[]>()
      sessionMap.set(fileType, [...(sessionMap.get(fileType) ?? []), file])
      bySession.set(sessionId, sessionMap)
    })
    return bySession
  }, [normalizedFileSearch, state.fileList])

  useEffect(() => {
    if (!normalizedFileSearch) return

    const matchedFiles = state.fileList.filter((file) =>
      file.filename.toLowerCase().includes(normalizedFileSearch)
    )
    if (matchedFiles.length === 0) return

    setExpandedCluster(true)
    setExpandedNodes((prev) => {
      const next = new Set(prev)
      matchedFiles.forEach((file) => {
        if (file.sessionId) next.add(file.sessionId)
      })
      return next
    })
    setExpandedTypes((prev) => {
      const next = new Set(prev)
      matchedFiles.forEach((file) => {
        if (file.sessionId) next.add(`${file.sessionId}:${getFileGroup(file)}`)
      })
      return next
    })
  }, [normalizedFileSearch, state.fileList])

  const handleClick = (file: FileRecord) => {
    if (state.hiddenFileIds.has(file.id)) {
      dispatch({ type: 'SHOW_FILE', fileId: file.id })
    }
    if (state.collapsedFileIds.has(file.id)) {
      dispatch({ type: 'TOGGLE_COLLAPSE', fileId: file.id })
    }
    onFocusFile(file.id)
  }

  const toggleNode = (sessionId: string) => {
    setExpandedNodes((prev) => toggleSetValue(prev, sessionId))
  }

  const toggleType = (sessionId: string, type: string) => {
    setExpandedTypes((prev) => toggleSetValue(prev, `${sessionId}:${type}`))
  }

  return (
    <aside className="file-tree-shell">
      <div className="file-tree-header">
        <span>Node list</span>
        <div className="file-tree-actions">
          <button
            type="button"
            aria-label={expandedCluster ? '收起节点列表' : '展开节点列表'}
            onClick={() => setExpandedCluster((value) => !value)}
          >
            {expandedCluster ? '−' : '+'}
          </button>
        </div>
      </div>

      <div className="file-search-panel">
        <label className="search-box">
          <span>⌕</span>
          <input
            type="text"
            placeholder="按日志文件名过滤"
            value={fileSearch}
            onChange={(e) => setFileSearch(e.target.value)}
          />
        </label>
      </div>

      <div className="cluster-tree">
        <button
          className="cluster-row tree-button"
          type="button"
          onClick={() => setExpandedCluster((value) => !value)}
        >
          <span className="tree-caret">{expandedCluster ? '▾' : '▸'}</span>
          <span className="cluster-dot" />
          <span className="cluster-title">Cluster:</span>
          <span className="cluster-name">{clusterName}</span>
        </button>

        {expandedCluster && (
          <div className="node-list">
            {sortedSessionRows.map((session, index) => {
              const nodeName = session.hostname || (index === 0 ? 'NodeA' : 'NodeB')
              const color = session.nodeColor
              const sessionExpanded = expandedNodes.has(session.sessionId)
              const filesByType =
                groupedFiles.get(session.sessionId) ?? new Map<string, FileRecord[]>()
              const fileCount = [...filesByType.values()].reduce(
                (sum, files) => sum + files.length,
                0
              )
              const isHAPair = haPairSessionIds.has(session.sessionId)
              const connectsToPrevious =
                isHAPair && areConsecutiveHAPair(sortedSessionRows[index - 1], session)
              const connectsToNext =
                isHAPair && areConsecutiveHAPair(session, sortedSessionRows[index + 1])
              const nodeBlockClasses = [
                'node-block',
                isHAPair && 'node-block--ha-pair',
                connectsToPrevious && 'node-block--ha-pair-end',
                connectsToNext && 'node-block--ha-pair-start',
              ]
                .filter(Boolean)
                .join(' ')

              return (
                <div
                  className={nodeBlockClasses}
                  key={session.sessionId}
                >
                  {isHAPair && <div className="ha-pair-line" />}
                  <button
                    className="node-row tree-button"
                    type="button"
                    onClick={() => toggleNode(session.sessionId)}
                  >
                    <span className="tree-caret">{sessionExpanded ? '▾' : '▸'}</span>
                    <span
                      className="node-dot"
                      style={{ backgroundColor: color }}
                    />
                    <span className="node-name">{nodeName}</span>
                    <span className="node-serial">({shortSerial(session.serialNum || session.sessionId)})</span>
                  </button>

                  {sessionExpanded && (
                    <div className="type-list">
                      {FILE_TYPE_ORDER.map((type) => {
                        const files = filesByType.get(type) ?? []
                        if (files.length === 0) return null
                        const typeKey = `${session.sessionId}:${type}`
                        const typeExpanded = expandedTypes.has(typeKey)

                        return (
                          <div className="type-block" key={typeKey}>
                            <button
                              className="type-row tree-button"
                              type="button"
                              onClick={() => toggleType(session.sessionId, type)}
                            >
                              <span className="tree-caret">{typeExpanded ? '▾' : '▸'}</span>
                              <span className="file-icon">{getTypeIcon(type)}</span>
                              <span className="type-name">{FILE_TYPE_LABELS[type]}</span>
                              <span className="tree-count">{files.length}</span>
                            </button>

                            {typeExpanded && (
                              <div className="file-list">
                                {files.map((file) => (
                                  <button
                                    className="file-row"
                                    key={file.id}
                                    type="button"
                                    draggable
                                    onDragStart={(e) => {
                                      isDragging.current = true
                                      e.dataTransfer.setData('text/plain', file.id)
                                      e.dataTransfer.effectAllowed = 'copy'
                                    }}
                                    onDragEnd={() => { isDragging.current = false }}
                                    onClick={() => {
                                      if (isDragging.current) return
                                      handleClick(file)
                                    }}
                                    title={file.filename}
                                  >
                                    <span className="file-icon">{getTypeIcon(type)}</span>
                                    <span className="file-name">{file.filename}</span>
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        )
                      })}
                      {fileCount === 0 && (
                        <div className="category-empty">暂无匹配文件</div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

    </aside>
  )
}

function getFileGroup(file: FileRecord): string {
  if (file.file_type === 'xml') return 'xml'
  if (file.file_type === 'ems') return 'ems'
  if (file.file_type === 'text') return 'txt'

  const name = file.filename.toLowerCase()
  if (name.endsWith('.xml')) return 'xml'
  if (name.endsWith('.txt') || name.endsWith('.log')) return 'txt'
  return 'other'
}

function getTypeIcon(type: string): string {
  if (type === 'xml') return '▧'
  if (type === 'ems') return '!'
  if (type === 'txt') return '≡'
  return '?'
}

function toggleSetValue(source: Set<string>, value: string): Set<string> {
  const next = new Set(source)
  if (next.has(value)) {
    next.delete(value)
  } else {
    next.add(value)
  }
  return next
}

function normalizeHostname(value?: string): string {
  return (value ?? '').trim().toLowerCase()
}

function areConsecutiveHAPair(left?: SessionMeta, right?: SessionMeta): boolean {
  if (!left || !right) return false

  const leftHostname = normalizeHostname(left.hostname)
  const rightHostname = normalizeHostname(right.hostname)
  if (!leftHostname || !rightHostname) return false

  return (
    normalizeHostname(left.partnerHostname) === rightHostname ||
    normalizeHostname(right.partnerHostname) === leftHostname
  )
}

function shortSerial(value: string): string {
  if (!value) return '-'
  return value.length > 13 ? `${value.slice(0, 6)}...${value.slice(-4)}` : value
}
