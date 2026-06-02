import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import {
  ReactFlow,
  MiniMap,
  Controls,
  Background,
  BackgroundVariant,
  useNodesState,
  useEdgesState,
  addEdge,
  useReactFlow,
  ReactFlowProvider,
} from '@xyflow/react'
import type { Node, Edge, NodeTypes, Connection } from '@xyflow/react'
import '@xyflow/react/dist/style.css'

import { ViewerProvider, useViewer } from './ViewerContext'
import type { Action } from './ViewerContext'
import FileTree from './FileTree'
import SearchPanel from './SearchPanel'
import NodeHUD from './NodeHUD'
import TextFileCard from './nodes/TextFileCard'
import XMLFileCard from './nodes/XMLFileCard'
import EMSFileCard from './nodes/EMSFileCard'
import AIChatPanel from './AIChatPanel'
import { getFiles, getSessionGroup, getSessionStatus } from '../../services/api'
import { getTemplates, getTemplate, createTemplate, deleteTemplate } from '../../services/api'
import type { FileRecord, SessionMeta, TemplateListItem, TemplateCard, TemplateEdge } from '../../types'

const NODE_COLORS = { blue: '#3b82f6', orange: '#f97316' }

const nodeTypes = {
  textFile: TextFileCard,
  xmlFile: XMLFileCard,
  emsFile: EMSFileCard,
} as unknown as NodeTypes

function fileTypeToNodeType(ft: FileRecord['file_type']): string {
  switch (ft) {
    case 'ems': return 'emsFile'
    case 'xml': return 'xmlFile'
    default: return 'textFile'
  }
}

function buildNode(
  file: FileRecord,
  position: { x: number; y: number },
  sessionId: string,
  nodeColor: string,
  dispatch: React.Dispatch<Action>
): Node {
  return {
    id: file.id,
    type: fileTypeToNodeType(file.file_type),
    position,
    data: {
      fileId: file.id,
      sessionId,
      filename: file.filename,
      nodeColor,
      collapsed: false,
      onCollapse: () => dispatch({ type: 'TOGGLE_COLLAPSE', fileId: file.id }),
      onHide: () => dispatch({ type: 'HIDE_FILE', fileId: file.id }),
    },
  }
}

const CARD_W = 340
const CARD_H = 60
let _spawnOffset = 0

function SplitGrid({ nodes, nodeTypes, state, onDropFile }: {
  nodes: Node[]
  nodeTypes: NodeTypes
  state: { hiddenFileIds: Set<string> }
  onDropFile: (fileId: string, replaceIdx?: number) => void
}) {
  const visibleCards = nodes.filter((n) => !state.hiddenFileIds.has((n.data as { fileId: string }).fileId))
  const cardCount = visibleCards.length
  const gridCols = cardCount <= 1 ? 1 : cardCount <= 3 ? cardCount : 2
  const gridRows = cardCount <= 3 ? 1 : 2
  const [dragOverZone, setDragOverZone] = useState<number | null>(null)
  const emptySlots = Math.max(0, 4 - cardCount)

  // Empty state: no cards yet
  if (cardCount === 0) {
    return (
      <div style={{
        width: '100%', height: '100%', background: '#f7f9fc',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: '#94a3b8', fontSize: 15,
      }}>
        点击左侧日志内容展示
      </div>
    )
  }

  const handleDrop = (zoneIdx: number, e: React.DragEvent) => {
    e.preventDefault()
    setDragOverZone(null)
    const fileId = e.dataTransfer.getData('text/plain')
    if (fileId) onDropFile(fileId, zoneIdx < cardCount ? zoneIdx : undefined)
  }

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: `repeat(${gridCols}, 1fr)`,
      gridTemplateRows: `repeat(${gridRows}, 1fr)`,
      width: '100%', height: '100%',
      gap: 8, padding: 8,
      background: '#f7f9fc',
    }}>
      {visibleCards.map((node, idx) => {
        const CardComponent = (nodeTypes as Record<string, React.ComponentType<{ data: unknown }>>)[node.type!]
        return (
          <div key={node.id} data-zone={idx} style={{
            border: dragOverZone === idx ? '2px solid #3b82f6' : '2px dashed #e2e8f0',
            borderRadius: 8, background: dragOverZone === idx ? '#eff6ff' : undefined,
            overflow: 'hidden', position: 'relative',
            transition: 'border 0.15s, background 0.15s',
          }}
            onDragOver={(e) => { e.preventDefault(); setDragOverZone(idx) }}
            onDragLeave={() => setDragOverZone(null)}
            onDrop={(e) => handleDrop(idx, e)}>
            <div style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
              {CardComponent && <CardComponent data={{ ...node.data, splitMode: true }} />}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function ViewerInner() {
  const params = useParams<{ sessionId?: string; groupId?: string }>()
  const { state, dispatch } = useViewer()
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])
  const onConnect = useCallback(
    (connection: Connection) => setEdges((eds) => addEdge({ ...connection, animated: false, style: { stroke: '#94a3b8', strokeWidth: 2 }, data: { label: '' } }, eds)),
    [setEdges]
  )
  const [sessions, setSessions] = useState<SessionMeta[]>([])
  const [sidebarWidth, setSidebarWidth] = useState(245)
  const dragging = useRef(false)
  const fileMetaRef = useRef<Map<string, { sessionId: string; nodeColor: string; file: FileRecord }>>(new Map())
  const { fitView, getViewport } = useReactFlow()
  const clusterName = sessions.find((s) => s.clusterId)?.clusterId || 'PROD-01'

  const [groupSessions, setGroupSessions] = useState<{
    id: string
    color: 'blue' | 'orange'
    hostname?: string
    serialNum?: string
    generatedOn?: string
    status?: string
  }[]>([])

  const [templates, setTemplates] = useState<TemplateListItem[]>([])
  const [searchMode, setSearchMode] = useState(false)
  const [templateName, setTemplateName] = useState('')
  const [selectedTemplateId, setSelectedTemplateId] = useState('')
  const [templateMsg, setTemplateMsg] = useState<string | null>(null)
  const [templateMsgType, setTemplateMsgType] = useState<'success' | 'error' | 'info'>('info')
  const [editingEdgeId, setEditingEdgeId] = useState<string | null>(null)
  const [editingLabel, setEditingLabel] = useState('')
  const [showAI, setShowAI] = useState(false)
  const [aiPanelWidth, setAiPanelWidth] = useState(450)
  const [splitMode, setSplitMode] = useState(false)

  useEffect(() => {
    async function load() {
      if (params.sessionId) {
        setGroupSessions([{ id: params.sessionId, color: 'blue' as const }])
      } else if (params.groupId) {
        try {
          const res = await getSessionGroup(params.groupId)
          const members = res.data.members
          const entries = members.map((m: {
            session_id: string
            hostname?: string
            serial_num?: string
            generated_on?: string
            status?: string
          }, i: number) => ({
            id: m.session_id,
            color: (i === 0 ? 'blue' : 'orange') as 'blue' | 'orange',
            hostname: m.hostname,
            serialNum: m.serial_num,
            generatedOn: m.generated_on,
            status: m.status,
          }))
          setGroupSessions(entries)
        } catch (err) {
          console.error('Failed to load group:', err)
        }
      }
    }
    load()
  }, [params.sessionId, params.groupId])

  useEffect(() => {
    groupSessions.forEach(({ id, color, hostname, serialNum, generatedOn, status }) => {
      Promise.all([
        getSessionStatus(id).catch(() => null),
        getFiles(id),
      ]).then(([statusRes, filesRes]) => {
        const sessionData = statusRes?.data
        const files: FileRecord[] = filesRes.data?.files ?? filesRes.data ?? []
        const nonEmpty = files.filter((f) => !f.is_empty)

        const meta: SessionMeta = {
          sessionId: id,
          serialNum: serialNum ?? sessionData?.serial_num ?? '',
          generatedOn: generatedOn ?? sessionData?.generated_on ?? '',
          nodeColor: color,
          hostname: hostname ?? sessionData?.hostname ?? '',
          status: status ?? sessionData?.status ?? '',
          fileCount: sessionData?.file_count,
          clusterId: sessionData?.cluster_id,
        }

        setSessions((prev) => {
          const exists = prev.find((s) => s.sessionId === id)
          if (exists) return prev
          return [...prev, meta]
        })

        const colorHex = NODE_COLORS[color]
        nonEmpty.forEach((f) => {
          fileMetaRef.current.set(f.id, { sessionId: id, nodeColor: colorHex, file: f })
        })

        dispatch({ type: 'SET_FILES', files: nonEmpty, sessionId: id, nodeColor: color })
      }).catch(console.error)
    })
  }, [groupSessions])

  useEffect(() => {
    if (params.sessionId || params.groupId) {
      getTemplates({
        sessionId: params.sessionId,
        groupId: params.groupId,
      }).then((res) => setTemplates(res.data.templates ?? [])).catch(() => {})
    }
  }, [params.sessionId, params.groupId])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'A') {
        e.preventDefault()
        fitView({ padding: 0.1, duration: 300 })
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [fitView])

  const handleFocusFile = useCallback(
    (fileId: string, replaceIdx?: number) => {
      setNodes((prev) => {
        const existing = prev.find((n) => n.id === fileId)
        if (existing) {
          if (!splitMode) {
            setTimeout(() => fitView({ nodes: [existing], padding: 0.3, duration: 400 }), 50)
          }
          return prev
        }

        const meta = fileMetaRef.current.get(fileId)
        if (!meta) return prev

        if (splitMode) {
          const visibleNodes = prev.filter((n) => !state.hiddenFileIds.has((n.data as { fileId: string }).fileId))
          // Replace specific zone
          if (replaceIdx !== undefined && replaceIdx < visibleNodes.length) {
            const target = visibleNodes[replaceIdx]
            const newNode = buildNode(meta.file, target.position, meta.sessionId, meta.nodeColor, dispatch)
            return prev.map((n) => (n.id === target.id ? newNode : n))
          }
          // Add new card (up to 4)
          if (visibleNodes.length < 4) {
            const newNode = buildNode(meta.file, { x: 0, y: 0 }, meta.sessionId, meta.nodeColor, dispatch)
            return [...prev, newNode]
          }
          // Full: replace last
          const lastVisible = visibleNodes[visibleNodes.length - 1]
          const newNode = buildNode(meta.file, lastVisible.position, meta.sessionId, meta.nodeColor, dispatch)
          return prev.map((n) => (n.id === lastVisible.id ? newNode : n))
        }

        const vp = getViewport()
        const canvasW = window.innerWidth - sidebarWidth - 4
        const canvasH = window.innerHeight - 56

        const cx = (-vp.x + canvasW / 2) / vp.zoom
        const cy = (-vp.y + canvasH / 2) / vp.zoom

        const offset = (_spawnOffset % 6) * 30
        _spawnOffset++

        const position = { x: cx - CARD_W / 2 + offset, y: cy - CARD_H / 2 + offset }
        const newNode = buildNode(meta.file, position, meta.sessionId, meta.nodeColor, dispatch)

        if (!splitMode) {
          setTimeout(() => fitView({ nodes: [newNode], padding: 0.3, duration: 400 }), 50)
        }
        return [...prev, newNode]
      })
    },
    [fitView, getViewport, sidebarWidth, dispatch, splitMode, state.hiddenFileIds]
  )

  const onEdgeDoubleClick = useCallback((event: React.MouseEvent, edge: Edge) => {
    event.stopPropagation()
    setEditingEdgeId(edge.id)
    setEditingLabel(edge.data?.label ?? '')
  }, [])

  const handleSaveTemplate = async () => {
    if (!templateName.trim()) return
    const cards = nodes.map((n) => ({
      file_id: (n.data as { fileId: string }).fileId,
      session_id: (n.data as { sessionId: string }).sessionId,
      filename: (n.data as { filename: string }).filename,
      node_index: Math.max(0, groupSessions.findIndex(s => s.id === (n.data as { sessionId: string }).sessionId)),
      pos_x: Math.round(n.position.x),
      pos_y: Math.round(n.position.y),
      collapsed: state.collapsedFileIds.has((n.data as { fileId: string }).fileId),
    }))
    if (cards.length === 0) {
      setTemplateMsg('No cards on canvas to save')
      setTemplateMsgType('error')
      return
    }
    const edgesData = edges.map((e, i) => ({
      edge_id: `edge_${i}`,
      source_file_id: e.source,
      target_file_id: e.target,
      label: (e.data as { label?: string })?.label ?? null,
    }))
    try {
      await createTemplate({
        name: templateName.trim(),
        session_id: params.sessionId,
        group_id: params.groupId,
        cards,
        edges: edgesData,
      })
      setTemplateName('')
      setTemplateMsg(`Template "${templateName.trim()}" saved (${cards.length} cards)`)
      setTemplateMsgType('success')
      const res = await getTemplates({
        sessionId: params.sessionId,
        groupId: params.groupId,
      })
      setTemplates(res.data.templates ?? [])
    } catch {
      setTemplateMsg('Failed to save template')
      setTemplateMsgType('error')
    }
  }

  const handleLoadTemplate = async (templateId: string) => {
    if (!templateId) return
    try {
      const res = await getTemplate(templateId)
      const { cards, edges } = res.data

      // Helper: find file metadata by (node_index, filename)
      const findByNodeAndFilename = (nodeIdx: number, filename: string) => {
        const targetSession = nodeIdx >= 0 && nodeIdx < groupSessions.length
          ? groupSessions[nodeIdx]
          : null
        for (const [, meta] of fileMetaRef.current) {
          if (meta.file.filename !== filename) continue
          // If in group mode, also match the session
          if (targetSession && meta.sessionId !== targetSession.id) continue
          return meta
        }
        return null
      }

      // First pass: check which sessions we need to fetch
      const missingSessions = new Set<string>()
      for (const card of cards) {
        const meta = findByNodeAndFilename(card.node_index, card.filename)
        if (!meta && card.session_id) {
          missingSessions.add(card.session_id)
        }
      }

      // Fetch missing session files
      if (missingSessions.size > 0) {
        await Promise.all(
          Array.from(missingSessions).map(async (sid) => {
            try {
              const filesRes = await getFiles(sid)
              const files: FileRecord[] = filesRes.data?.files ?? filesRes.data ?? []
              const session = groupSessions.find(s => s.id === sid)
              const colorHex = NODE_COLORS[session?.color ?? 'blue']
              files.filter((f) => !f.is_empty).forEach((f) => {
                fileMetaRef.current.set(f.id, {
                  sessionId: sid,
                  nodeColor: colorHex,
                  file: f,
                })
              })
            } catch {
              console.warn(`[Template] Failed to fetch files for session ${sid}`)
            }
          })
        )
      }

      // Second pass: create nodes using (node_index, filename) matching
      let loaded = 0
      let skipped = 0
      const newNodes: Node[] = []

      cards.forEach((card: TemplateCard) => {
        // Try (node_index, filename) match first
        let meta = findByNodeAndFilename(card.node_index, card.filename)

        // Fallback: filename-only match across all sessions
        if (!meta && card.filename) {
          for (const [, m] of fileMetaRef.current) {
            if (m.file.filename === card.filename) {
              meta = m
              break
            }
          }
        }

        if (!meta) {
          skipped++
          return
        }
        const newNode = buildNode(
          meta.file,
          { x: card.pos_x, y: card.pos_y },
          meta.sessionId,
          meta.nodeColor,
          dispatch
        )
        if (card.collapsed) {
          dispatch({ type: 'TOGGLE_COLLAPSE', fileId: meta.file.id })
        }
        newNodes.push(newNode)
        loaded++
        dispatch({ type: 'SHOW_FILE', fileId: meta.file.id })
      })

      setNodes((prev) => {
        const existingIds = new Set(prev.map((n) => n.id))
        const toAdd = newNodes.filter((n) => !existingIds.has(n.id))
        return [...prev, ...toAdd]
      })

      // Restore edges (filter by current node IDs)
      if (edges && edges.length > 0) {
        const currentNodes = nodes
        const edgeNodes = new Set(newNodes.map((n) => n.id))
        currentNodes.forEach((n) => edgeNodes.add(n.id))
        const restoredEdges: Edge[] = edges
          .filter((e: TemplateEdge) => edgeNodes.has(e.source_file_id) && edgeNodes.has(e.target_file_id))
          .map((e: TemplateEdge) => ({
            id: e.edge_id,
            source: e.source_file_id,
            target: e.target_file_id,
            animated: false,
            style: { stroke: '#94a3b8', strokeWidth: 2 },
            data: { label: e.label ?? '' },
            label: e.label ?? '',
          }))
        setEdges((prev) => {
          const existingEdgeIds = new Set(prev.map((e) => e.id))
          const toAdd = restoredEdges.filter((e) => !existingEdgeIds.has(e.id))
          return [...prev, ...toAdd]
        })
      }

      setTimeout(() => fitView({ padding: 0.15, duration: 400 }), 100)

      const msg = skipped > 0
        ? `Loaded ${loaded} cards, ${skipped} files not found`
        : `Loaded ${loaded} cards`
      setTemplateMsg(msg)
      setTemplateMsgType(skipped > 0 ? 'info' : 'success')
    } catch {
      setTemplateMsg('Failed to load template')
      setTemplateMsgType('error')
    }
  }

  const visibleNodes = useMemo(
    () =>
      nodes.map((n) => {
        const fileId = (n.data as { fileId: string }).fileId
        const hidden = state.hiddenFileIds.has(fileId)
        const collapsed = state.collapsedFileIds.has(fileId)
        return { ...n, hidden, data: { ...n.data, collapsed } }
      }),
    [nodes, state.hiddenFileIds, state.collapsedFileIds]
  )

  const startDrag = (e: React.MouseEvent) => {
    e.preventDefault()
    dragging.current = true
    const onMove = (ev: MouseEvent) => {
      if (!dragging.current) return
      setSidebarWidth((w) => Math.max(140, Math.min(400, w + ev.movementX)))
    }
    const onUp = () => {
      dragging.current = false
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const startAIDrag = (e: React.MouseEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const startWidth = aiPanelWidth
    const onMove = (ev: MouseEvent) => {
      const delta = startX - ev.clientX
      setAiPanelWidth(Math.max(280, Math.min(1000, startWidth + delta)))
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  return (
    <div className="viewer-layout">
      <div style={{ width: sidebarWidth, flexShrink: 0, display: 'flex', flexDirection: 'column', height: '100%' }}>
        {/* Tab buttons */}
        <div style={{ display: 'flex', borderBottom: '1px solid #e2e8f0', background: '#f8fafc', borderRight: '1px solid #e2e8f0' }}>
          <button onClick={() => setSearchMode(false)} style={{
            flex: 1, padding: '6px 8px', border: 'none', background: !searchMode ? '#ffffff' : 'transparent',
            borderRight: '1px solid #e2e8f0', cursor: 'pointer', fontSize: 11, fontWeight: 500,
            color: !searchMode ? '#1e293b' : '#94a3b8', fontFamily: 'ui-monospace, Consolas, monospace',
          }}>
            Files
          </button>
          <button onClick={() => setSearchMode(true)} style={{
            flex: 1, padding: '6px 8px', border: 'none', background: searchMode ? '#ffffff' : 'transparent',
            cursor: 'pointer', fontSize: 11, fontWeight: 500,
            color: searchMode ? '#1e293b' : '#94a3b8', fontFamily: 'ui-monospace, Consolas, monospace',
          }}>
            Search
          </button>
        </div>
        
        {/* Content area */}
        <div style={{ flex: 1, overflow: 'hidden' }}>
          {!searchMode ? (
            <FileTree sessions={sessions} clusterName={clusterName} onFocusFile={handleFocusFile} />
          ) : (
            <SearchPanel sessions={groupSessions} onFocusFile={handleFocusFile} />
          )}
        </div>
      </div>

      <div
        onMouseDown={startDrag}
        style={{
          width: 4,
          cursor: 'col-resize',
          background: '#e2e8f0',
          flexShrink: 0,
          transition: 'background 0.15s',
        }}
        onMouseEnter={(e) => (e.currentTarget.style.background = '#3b82f6')}
        onMouseLeave={(e) => (e.currentTarget.style.background = '#e2e8f0')}
      />

      <main className="viewer-main" style={{ position: 'relative' }}>
        <NodeHUD sessions={sessions} />

        {/* Template bar */}
        <div className="template-bar nodrag" style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '6px 16px', background: '#f8fafc',
          borderBottom: '1px solid #e2e8f0', fontSize: 12,
        }}>
          <button
            onClick={() => { setNodes([]); setEdges([]); _spawnOffset = 0 }}
            title="关闭所有卡片"
            style={{
              background: 'none', border: '1px solid #e2e8f0', borderRadius: 4,
              color: '#94a3b8', cursor: 'pointer', padding: '3px 8px',
              fontSize: 11, fontFamily: 'ui-monospace, Consolas, monospace',
            }}
          >
            ✕ Clear
          </button>
          <button
            onClick={() => setSplitMode(!splitMode)}
            title={splitMode ? 'Switch to canvas mode' : 'Switch to grid mode'}
            style={{
              background: 'none', border: '1px solid #e2e8f0', borderRadius: 4,
              color: splitMode ? '#3b82f6' : '#94a3b8', cursor: 'pointer', padding: '3px 8px',
              fontSize: 11, fontFamily: 'ui-monospace, Consolas, monospace',
            }}
          >
            {splitMode ? '⊞ Grid' : '⊞ Split'}
          </button>
          <input
            type="text"
            placeholder="Template name..."
            value={templateName}
            onChange={(e) => setTemplateName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleSaveTemplate() }}
            style={{
              width: 140, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 4,
              color: '#1e293b', padding: '3px 8px', fontSize: 11, outline: 'none',
              fontFamily: 'ui-monospace, Consolas, monospace',
            }}
          />
          <button onClick={handleSaveTemplate} style={templateBtnStyle}>
            💾 Save
          </button>
          <div style={{ width: 1, height: 16, background: '#e2e8f0' }} />
          <div style={{ width: 1, height: 16, background: '#e2e8f0' }} />
          <select
            value={selectedTemplateId}
            onChange={(e) => { setSelectedTemplateId(e.target.value); handleLoadTemplate(e.target.value) }}
            style={{
              background: '#fff', border: '1px solid #e2e8f0', borderRadius: 4,
              color: '#1e293b', padding: '3px 8px', fontSize: 11, outline: 'none',
              fontFamily: 'ui-monospace, Consolas, monospace',
            }}
          >
            <option value="">Load template…</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>{t.name} ({t.card_count})</option>
            ))}
          </select>
          {selectedTemplateId && (
            <button
              onClick={async () => {
                if (!window.confirm('Delete this template?')) return
                try {
                  await deleteTemplate(selectedTemplateId)
                  setSelectedTemplateId('')
                  const res = await getTemplates({
                    sessionId: params.sessionId,
                    groupId: params.groupId,
                  })
                  setTemplates(res.data.templates ?? [])
                  setTemplateMsg('Template deleted')
                  setTemplateMsgType('info')
                } catch {
                  setTemplateMsg('Failed to delete template')
                  setTemplateMsgType('error')
                }
              }}
              style={{
                background: '#ef4444', border: '1px solid #dc2626', borderRadius: 4,
                color: '#fff', cursor: 'pointer', padding: '3px 8px',
                fontSize: 11, fontFamily: 'system-ui, -apple-system, sans-serif',
              }}
              title="Delete template"
            >
              🗑️
            </button>
          )}
          {templateMsg && (
            <>
              <div style={{ width: 1, height: 16, background: '#e2e8f0' }} />
              <span style={{
                color: templateMsgType === 'error' ? '#ef4444' : templateMsgType === 'success' ? '#22c55e' : '#3b82f6',
                fontSize: 11,
              }}>
                {templateMsg}
              </span>
              <button onClick={() => setTemplateMsg(null)} style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: 11, padding: '0 2px' }}>×</button>
            </>
          )}
        </div>

        <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
          {/* Canvas or Split Grid */}
          <div className="viewer-canvas" style={{ flex: 1 }}>
            {!splitMode && (
            <ReactFlow
              nodes={visibleNodes}
              edges={edges}
              nodeTypes={nodeTypes}
              onNodesChange={onNodesChange}
              fitView={false}
              minZoom={0.1}
              maxZoom={2}
              style={{ background: '#f7f9fc' }}
              deleteKeyCode={null}
            >
              <Background variant={BackgroundVariant.Dots} color="#d6dde8" />
              <Controls position="bottom-left" />
              <MiniMap
                position="bottom-right"
                pannable
                zoomable
                nodeColor={(n) => {
                  const color = (n.data as { nodeColor?: string }).nodeColor
                  return color ?? '#3b82f6'
                }}
                style={{ background: '#f8fafc', border: '1px solid #e2e8f0' }}
              />
            </ReactFlow>
            )}
            {splitMode && <SplitGrid nodes={visibleNodes} nodeTypes={nodeTypes} state={state} onDropFile={handleFocusFile} />}
          </div>

          {/* AI Chat Panel */}
          {showAI && (
            <>
              <div
                onMouseDown={startAIDrag}
                style={{
                  width: 4,
                  cursor: 'col-resize',
                  background: '#e2e8f0',
                  flexShrink: 0,
                  transition: 'background 0.15s',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = '#3b82f6')}
                onMouseLeave={(e) => (e.currentTarget.style.background = '#e2e8f0')}
              />
              <div style={{ width: aiPanelWidth, flexShrink: 0 }}>
                <AIChatPanel
                  sessionIds={groupSessions.map(s => s.id)}
                  groupSessions={groupSessions}
                  onFocusFile={handleFocusFile}
                  onClose={() => setShowAI(false)}
                />
              </div>
            </>
          )}

          {/* AI toggle button — floating on canvas when panel is hidden */}
          {!showAI && (
            <button
              onClick={() => setShowAI(true)}
              style={{
                position: 'absolute', top: 60, right: 12, zIndex: 100,
                background: '#ffffff', border: '1px solid #e2e8f0',
                borderRadius: 20, padding: '4px 12px',
                cursor: 'pointer', fontSize: 12, fontWeight: 500,
                color: '#475569', display: 'flex', alignItems: 'center', gap: 4,
                boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
                fontFamily: 'system-ui, -apple-system, sans-serif',
              }}
            >
              <span>🤖</span> AI
            </button>
          )}
        </div>

        {editingEdgeId && (
          <div style={{
            position: 'fixed', inset: 0, zIndex: 10000,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(0,0,0,0.3)',
          }} onClick={() => setEditingEdgeId(null)}>
            <div style={{
              background: '#fff', borderRadius: 8, padding: 16,
              boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
              minWidth: 280,
            }} onClick={(e) => e.stopPropagation()}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#1e293b', marginBottom: 8 }}>
                Edit edge label
              </div>
              <input
                autoFocus
                value={editingLabel}
                onChange={(e) => setEditingLabel(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    setEdges((eds) => eds.map((ed) =>
                      ed.id === editingEdgeId
                        ? { ...ed, data: { ...ed.data, label: editingLabel }, label: editingLabel }
                        : ed
                    ))
                    setEditingEdgeId(null)
                  }
                  if (e.key === 'Escape') setEditingEdgeId(null)
                }}
                placeholder="Enter label..."
                style={{
                  width: '100%', padding: '6px 10px', fontSize: 12,
                  border: '1px solid #e2e8f0', borderRadius: 4, outline: 'none',
                  fontFamily: 'ui-monospace, Consolas, monospace',
                  boxSizing: 'border-box',
                }}
              />
              <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 8 }}>
                <button onClick={() => setEditingEdgeId(null)}
                  style={{ background: 'none', border: '1px solid #e2e8f0', borderRadius: 4, padding: '4px 12px', fontSize: 11, cursor: 'pointer' }}>
                  Cancel
                </button>
                <button onClick={() => {
                  setEdges((eds) => eds.map((ed) =>
                    ed.id === editingEdgeId
                      ? { ...ed, data: { ...ed.data, label: editingLabel }, label: editingLabel }
                      : ed
                  ))
                  setEditingEdgeId(null)
                }}
                  style={{ background: '#3b82f6', border: 'none', borderRadius: 4, color: '#fff', padding: '4px 12px', fontSize: 11, cursor: 'pointer' }}>
                  Save
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}

const templateBtnStyle: React.CSSProperties = {
  background: '#3b82f6', border: 'none', borderRadius: 4,
  color: '#fff', cursor: 'pointer', padding: '3px 10px',
  fontSize: 11, fontFamily: 'ui-monospace, Consolas, monospace',
  fontWeight: 500,
}

export default function ViewerPage() {
  return (
    <ViewerProvider>
      <ReactFlowProvider>
        <ViewerInner />
      </ReactFlowProvider>
    </ViewerProvider>
  )
}
