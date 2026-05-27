import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import {
  ReactFlow,
  MiniMap,
  Controls,
  Background,
  BackgroundVariant,
  useNodesState,
  useReactFlow,
  ReactFlowProvider,
} from '@xyflow/react'
import type { Node, NodeTypes } from '@xyflow/react'
import '@xyflow/react/dist/style.css'

import { ViewerProvider, useViewer } from './ViewerContext'
import type { Action } from './ViewerContext'
import FileTree from './FileTree'
import NodeHUD from './NodeHUD'
import TextFileCard from './nodes/TextFileCard'
import XMLFileCard from './nodes/XMLFileCard'
import EMSFileCard from './nodes/EMSFileCard'
import { getFiles, getSessionStatus } from '../../services/api'
import type { FileRecord, SessionMeta } from '../../types'
import { waterfallLayout } from './utils/layout'

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

function ViewerInner() {
  const params = useParams<{ sessionId?: string; groupId?: string }>()
  const { state, dispatch } = useViewer()
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([])
  const [sessions, setSessions] = useState<SessionMeta[]>([])
  const [sidebarWidth, setSidebarWidth] = useState(220)
  const dragging = useRef(false)
  const { fitView } = useReactFlow()

  const sessionIds = useMemo(() => {
    if (params.sessionId) return [{ id: params.sessionId, color: 'blue' as const }]
    if (params.groupId) {
      return [
        { id: `${params.groupId}-node1`, color: 'blue' as const },
        { id: `${params.groupId}-node2`, color: 'orange' as const },
      ]
    }
    return []
  }, [params.sessionId, params.groupId])

  useEffect(() => {
    sessionIds.forEach(({ id, color }) => {
      Promise.all([getSessionStatus(id).catch(() => null), getFiles(id)])
        .then(([statusRes, filesRes]) => {
          const sessionData = statusRes?.data
          const files: FileRecord[] = filesRes.data ?? []
          const nonEmpty = files.filter((f) => !f.is_empty)

          const meta: SessionMeta = {
            sessionId: id,
            serialNum: sessionData?.serial_num ?? sessionData?.node?.serial_num ?? '',
            generatedOn: sessionData?.generated_on ?? '',
            nodeColor: color,
          }

          setSessions((prev) => {
            const exists = prev.find((s) => s.sessionId === id)
            if (exists) return prev
            return [...prev, meta]
          })

          dispatch({ type: 'SET_FILES', files: nonEmpty, sessionId: id, nodeColor: color })

          const positions = waterfallLayout(nonEmpty)
          const nodeColorHex = NODE_COLORS[color]

          setNodes((prev) => {
            const existingIds = new Set(prev.map((n) => n.id))
            const newNodes = positions
              .filter((p) => !existingIds.has(p.id))
              .map((p) => {
                const file = nonEmpty.find((f) => f.id === p.id)!
                return buildNode(file, p.position, id, nodeColorHex, dispatch)
              })
            return [...prev, ...newNodes]
          })
        })
        .catch(console.error)
    })
  }, [sessionIds])

  useEffect(() => {
    if (nodes.length > 0) {
      setTimeout(() => fitView({ padding: 0.1, duration: 300 }), 100)
    }
  }, [nodes.length])

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

  const visibleNodes = useMemo(
    () =>
      nodes.map((n) => {
        const fileId = (n.data as { fileId: string }).fileId
        const hidden = state.hiddenFileIds.has(fileId)
        const collapsed = state.collapsedFileIds.has(fileId)
        return {
          ...n,
          hidden,
          data: {
            ...n.data,
            collapsed,
          },
        }
      }),
    [nodes, state.hiddenFileIds, state.collapsedFileIds]
  )

  const handleFocusFile = useCallback(
    (fileId: string) => {
      const node = nodes.find((n) => (n.data as { fileId: string }).fileId === fileId)
      if (node) {
        fitView({ nodes: [node], padding: 0.3, duration: 400 })
      }
    },
    [nodes, fitView]
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

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', background: '#0f0f1a' }}>
      <div style={{ width: sidebarWidth, flexShrink: 0 }}>
        <FileTree onFocusFile={handleFocusFile} />
      </div>

      <div
        onMouseDown={startDrag}
        style={{
          width: 4,
          cursor: 'col-resize',
          background: '#2a2a3e',
          flexShrink: 0,
          transition: 'background 0.15s',
        }}
        onMouseEnter={(e) => (e.currentTarget.style.background = '#3b82f6')}
        onMouseLeave={(e) => (e.currentTarget.style.background = '#2a2a3e')}
      />

      <div style={{ flex: 1, position: 'relative' }}>
        <NodeHUD sessions={sessions} />

        <ReactFlow
          nodes={visibleNodes}
          edges={[]}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          fitView={false}
          minZoom={0.1}
          maxZoom={2}
          style={{ background: '#0f0f1a' }}
          deleteKeyCode={null}
        >
          <Background variant={BackgroundVariant.Dots} color="#2a2a3e" />
          <Controls position="bottom-left" />
          <MiniMap
            position="bottom-right"
            pannable
            zoomable
            nodeColor={(n) => {
              const color = (n.data as { nodeColor?: string }).nodeColor
              return color ?? '#3b82f6'
            }}
            style={{ background: '#13131f', border: '1px solid #2a2a3e' }}
          />
        </ReactFlow>
      </div>
    </div>
  )
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
