import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  ReactFlow,
  MiniMap,
  Controls,
  Background,
  BackgroundVariant,
  addEdge,
  applyNodeChanges,
  applyEdgeChanges,
  useReactFlow,
  ReactFlowProvider,
} from '@xyflow/react'
import type { Node, Edge, NodeTypes, Connection, NodeChange, EdgeChange } from '@xyflow/react'
import '@xyflow/react/dist/style.css'

import { ViewerProvider, useViewer } from './ViewerContext'
import type { Action } from './ViewerContext'
import FileTree from './FileTree'
import SearchPanel from './SearchPanel'
import NodeHUD from './NodeHUD'
import TextFileCard from './nodes/TextFileCard'
import XMLFileCard from './nodes/XMLFileCard'
import EMSFileCard from './nodes/EMSFileCard'
import MermaidDiagram from './nodes/MermaidDiagram'
import AIChatPanel, { type Message } from './AIChatPanel'
import TabBar from './TabBar'
import { getAiSummary, getConfig, getFiles, getSessionGroup, getSessionStatus } from '../../services/api'
import { getTemplates, getTemplate, createTemplate, deleteTemplate } from '../../services/api'
import type { FileRecord, SessionMeta, TemplateListItem, TemplateCard, TemplateEdge } from '../../types'

export type ChatMode = 'analysis' | 'autonomous'
type NodeViewportReadySize = { width?: number; height?: number }
export type NodeViewportReadyHandler = (nodeId: string, size?: NodeViewportReadySize) => void

type NodeDimensions = { width: number; height: number }
type AISummarySectionData = { label: string; summaries: string[] }
type SpawnCenterRequest = {
  tabId: string
  center: { x: number; y: number }
  ready: boolean
  readyWidth?: number
  positioned: boolean
}

export interface Tab {
  id: string
  name: string
  nodes: Node[]
  edges: Edge[]
  chatMode: ChatMode
  isAutoAI?: boolean
}

const NODE_COLORS_POOL = ['#3b82f6', '#f97316', '#22c55e', '#a855f7', '#ef4444', '#eab308', '#06b6d4', '#ec4899']
function nodeColorFor(index: number) { return NODE_COLORS_POOL[index % NODE_COLORS_POOL.length] }

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
  dispatch: React.Dispatch<Action>,
  onReadyForViewport?: NodeViewportReadyHandler
): Node {
  return {
    id: file.id,
    type: fileTypeToNodeType(file.file_type),
    position,
    data: {
      fileId: file.id,
      sessionId,
      filename: file.filename,
      aiSummary: '',
      nodeColor,
      collapsed: false,
      onCollapse: () => dispatch({ type: 'TOGGLE_COLLAPSE', fileId: file.id }),
      onHide: () => dispatch({ type: 'HIDE_FILE', fileId: file.id }),
      onDuplicate: () => {},
      onReadyForViewport,
    },
  }
}

function dedupeNodesById(nodes: Node[]): Node[] {
  const seen = new Set<string>()
  return nodes.filter((node) => {
    if (seen.has(node.id)) return false
    seen.add(node.id)
    return true
  })
}

const INITIAL_CARD_SIZES: Record<string, { width: number; height: number }> = {
  textFile: { width: 900, height: 340 },
  emsFile: { width: 800, height: 400 },
  xmlFile: { width: 320, height: 360 },
}

function initialCardSizeFor(file: FileRecord): { width: number; height: number } {
  return INITIAL_CARD_SIZES[fileTypeToNodeType(file.file_type)] ?? { width: 320, height: 380 }
}

function dimensionsMatchReadySize(dimensions: NodeDimensions, readyWidth?: number) {
  return readyWidth === undefined || Math.abs(dimensions.width - readyWidth) <= 1
}

const SPLIT_GRID_MAX_CARDS = 8
let _spawnOffset = 0

function nodeIdKeyFor(ids: string[]) {
  return JSON.stringify(ids)
}

function nodeIdsFromKey(key: string) {
  return JSON.parse(key) as string[]
}

function syncCardOrder(prev: string[], currentIds: string[]) {
  const currentIdSet = new Set(currentIds)
  const retained = prev.filter((id) => currentIdSet.has(id))
  const existing = new Set(retained)
  // Insert new IDs at their position in currentIds, after retained entries
  const next = [...retained]
  currentIds.forEach((id, parentIdx) => {
    if (existing.has(id)) return
    next.splice(Math.min(parentIdx, next.length), 0, id)
    existing.add(id)
  })
  return next
}

const TIPS = [
  '📌 点击卡片标题中的主机名，左侧文件树会自动定位到对应节点',
  '🔍 搜索栏支持按集群 ID、主机名和序列号进行查找',
  '🗂️ 点击 ⊞ Grid 按钮可切换到网格模式，最多展示 8 张卡片',
  '📐 拖拽 XML 列表头右侧边缘可自由调整列宽',
  '点击列头 ⇄ 按钮可替换当前列为其他可用列，顶部支持搜索',
  '点击列头 🔒 按钮可锁定列，横向滚动时始终可见',
  '💾 模板会记住当前模式——网格模式下保存，加载时自动切回网格',
  '🎯 Grid模式下拖拽文件到卡片位置即可替换',
  '🤖 点击 AI 按钮召唤助手，它能直接读懂你的日志',
  '🪄 分析模式下 AI 会根据你打开的日志和需求进行针对性分析',
  '🚀 自主模式下 AI 会主动打开日志开始分析，不用你动手',
  '点击标题栏 [⧉] 按钮可复制卡片，复制窗口不会被 AI 读取',
  '🐑 beep beep im a sheep 🐑',
]

function TipsTicker() {
  const [idx, setIdx] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setIdx((i) => (i + 1) % TIPS.length), 6000)
    return () => clearInterval(t)
  }, [])
  return (
    <span style={{
      fontSize: 11, color: '#1e293b', fontWeight: 600, overflow: 'hidden',
      whiteSpace: 'nowrap', maxWidth: 420,
    }}>
      💡 {TIPS[idx]}
    </span>
  )
}

function SplitDivider({ direction, onMouseDown }: { direction: 'h' | 'v'; onMouseDown: (e: React.MouseEvent) => void }) {
  return (
    <div
      style={{
        width: direction === 'v' ? 4 : '100%',
        height: direction === 'h' ? 4 : '100%',
        cursor: direction === 'v' ? 'col-resize' : 'row-resize',
        background: '#e2e8f0',
        flexShrink: 0,
        transition: 'background 0.15s',
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = '#3b82f6')}
      onMouseLeave={(e) => (e.currentTarget.style.background = '#e2e8f0')}
      onMouseDown={onMouseDown}
    />
  )
}

function AISummaryPanel({
  sections,
  onClose,
}: {
  sections: AISummarySectionData[]
  onClose: () => void
}) {
  const [openSections, setOpenSections] = useState<Set<string>>(new Set())
  const prevLabelsRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    const currentLabels = new Set(sections.map(s => s.label))
    const prevLabels = prevLabelsRef.current

    setOpenSections((prev) => {
      const next = new Set(prev)
      currentLabels.forEach((label) => {
        if (!prevLabels.has(label)) next.add(label)
      })
      return next
    })

    prevLabelsRef.current = currentLabels
  }, [sections])

  const toggleSection = (label: string) => {
    setOpenSections((prev) => {
      const next = new Set(prev)
      if (next.has(label)) next.delete(label)
      else next.add(label)
      return next
    })
  }

  return (
    <div className="ai-summary-panel" role="complementary" aria-labelledby="ai-summary-title">
      <div className="ai-summary-panel-header">
        <div>
          <div id="ai-summary-title" className="ai-summary-panel-title">Insight</div>
          <div className="ai-summary-panel-subtitle">
            {sections.length} node{sections.length === 1 ? '' : 's'}
          </div>
        </div>
        <button type="button" className="ai-summary-close" aria-label="Close AI summary" onClick={onClose}>
          ×
        </button>
      </div>

      <div className="ai-summary-panel-body">
        {sections.map((section) => {
          const isOpen = openSections.has(section.label)
          return (
            <section className="ai-summary-section" key={section.label}>
              <button
                type="button"
                className="ai-summary-section-header"
                aria-expanded={isOpen}
                onClick={() => toggleSection(section.label)}
              >
                <span className="ai-summary-section-chevron">{isOpen ? '▾' : '▸'}</span>
                <span className="ai-summary-section-name">{section.label}</span>
                {section.summaries.length > 1 && (
                  <span className="ai-summary-section-count">{section.summaries.length}</span>
                )}
              </button>
              {isOpen && (
                <div className="ai-summary-section-content">
                  {section.summaries.map((summary, index) => (
                    <div className="ai-summary-markdown markdown-body" key={`${section.label}-${index}`}>
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={{
                          a: ({ node: _node, ...props }) => (
                            <a {...props} target="_blank" rel="noopener noreferrer" />
                          ),
                          code: ({ className, children, ...props }) => {
                            const code = String(children).replace(/\n$/, '')
                            if (className === 'language-mermaid') {
                              return <MermaidDiagram chart={code} />
                            }
                            return <code className={className} {...props}>{children}</code>
                          },
                        }}
                      >
                        {summary}
                      </ReactMarkdown>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )
        })}
      </div>
    </div>
  )
}

function SplitCard({ node, nodeTypes, idx, dragOverZone, setDragOverZone, handleDrop, swapDragSource, onGridDragStart, onGridDragEnd, onSwapDrop, style }: {
  node: Node
  nodeTypes: NodeTypes
  idx: number
  dragOverZone: number | null
  setDragOverZone: (z: number | null) => void
  handleDrop: (zoneIdx: number, e: React.DragEvent) => void
  swapDragSource: number | null
  onGridDragStart: () => void
  onGridDragEnd: () => void
  onSwapDrop: (targetIdx: number) => void
  style?: React.CSSProperties
}) {
  const CardComponent = (nodeTypes as Record<string, React.ComponentType<{ data: unknown }>>)[node.type!]
  const isSwapTarget = swapDragSource !== null && swapDragSource !== idx
  return (
    <div style={{
      ...style,
      border: swapDragSource === idx ? '2px dashed #3b82f6' : isSwapTarget ? '2px dashed #a855f7' : dragOverZone === idx ? '2px solid #3b82f6' : '2px solid transparent',
      borderRadius: 8, background: dragOverZone === idx ? '#eff6ff' : isSwapTarget ? '#faf5ff' : undefined,
      overflow: 'hidden', position: 'relative',
      transition: 'border 0.15s, background 0.15s',
      opacity: swapDragSource === idx ? 0.5 : 1,
    }}
      onDragOver={(e) => {
        e.preventDefault()
        if (swapDragSource !== null && swapDragSource !== idx) {
          e.dataTransfer.dropEffect = 'move'
        }
        setDragOverZone(idx)
      }}
      onDragLeave={() => setDragOverZone(null)}
      onDrop={(e) => {
        if (swapDragSource !== null) {
          e.preventDefault()
          onSwapDrop(idx)
          return
        }
        handleDrop(idx, e)
      }}>
      <div style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
        {CardComponent && <CardComponent data={{ ...node.data, splitMode: true, onGridDragStart, onGridDragEnd }} />}
      </div>
    </div>
  )
}

function SplitGrid({ nodes, nodeTypes, onSpawnCard }: {
  nodes: Node[]
  nodeTypes: NodeTypes
  onSpawnCard: (fileId: string, replaceNodeId?: string) => string | null
}) {
  const gridNodes = nodes.slice(0, SPLIT_GRID_MAX_CARDS)
  const nodeIdKey = nodeIdKeyFor(gridNodes.map((node) => node.id))
  const currentGridNodeIds = useMemo(() => nodeIdsFromKey(nodeIdKey), [nodeIdKey])
  const [cardOrder, setCardOrder] = useState<string[]>(() => currentGridNodeIds)
  const [dragOverZone, setDragOverZone] = useState<number | null>(null)
  const [swapDragSource, setSwapDragSource] = useState<number | null>(null)
  const [hRatio, setHRatio] = useState(50)
  const [vRatio, setVRatio] = useState(50)
  const [col3Ratios, setCol3Ratios] = useState([33.33, 33.34, 33.33])
  const containerRef = useRef<HTMLDivElement>(null)

  const orderedCardIds = useMemo(
    () => syncCardOrder(cardOrder, currentGridNodeIds),
    [cardOrder, currentGridNodeIds]
  )

  const orderedNodes = useMemo(() => {
    const nodeMap = new Map(gridNodes.map((node) => [node.id, node]))
    return orderedCardIds.map((id) => nodeMap.get(id)).filter(Boolean) as Node[]
  }, [orderedCardIds, gridNodes])

  const cardCount = orderedNodes.length
  const allXML = orderedNodes.every((node) => node.type === 'xmlFile')
  const gridRowRatioKey = allXML ? `xml:${cardCount}` : `grid:${Math.ceil(cardCount / 2)}`
  const [gridRowRatioState, setGridRowRatioState] = useState<{ key: string; ratios: number[] }>({
    key: gridRowRatioKey,
    ratios: [],
  })
  const storedGridRowRatios = gridRowRatioState.key === gridRowRatioKey ? gridRowRatioState.ratios : []

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
    if (fileId) {
      const targetNode = orderedNodes[zoneIdx]
      const newNodeId = onSpawnCard(fileId, targetNode?.id)
      if (!newNodeId) return
      setCardOrder((prev) => {
        const next = syncCardOrder(prev, currentGridNodeIds).filter((id) => id !== newNodeId)
        if (zoneIdx < next.length) {
          next[zoneIdx] = newNodeId
        } else {
          next.push(newNodeId)
        }
        return next
      })
    }
  }

  const clamp = (val: number, min: number, max: number) => Math.max(min, Math.min(max, val))

  const startHDrag = (e: React.MouseEvent) => {
    e.preventDefault()
    const container = containerRef.current
    if (!container) return
    const startX = e.clientX
    const startRatio = hRatio
    const totalW = container.clientWidth
    const onMove = (ev: MouseEvent) => {
      const delta = ev.clientX - startX
      const pctDelta = (delta / totalW) * 100
      setHRatio(clamp(startRatio + pctDelta, 20, 80))
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const startVDrag = (e: React.MouseEvent) => {
    e.preventDefault()
    const container = containerRef.current
    if (!container) return
    const startY = e.clientY
    const startRatio = vRatio
    const totalH = container.clientHeight
    const onMove = (ev: MouseEvent) => {
      const delta = ev.clientY - startY
      const pctDelta = (delta / totalH) * 100
      setVRatio(clamp(startRatio + pctDelta, 20, 80))
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const startCol3Drag = (dividerIdx: number, e: React.MouseEvent) => {
    e.preventDefault()
    const container = containerRef.current
    if (!container) return
    const startX = e.clientX
    const startRatios = [...col3Ratios]
    const totalW = container.clientWidth
    const onMove = (ev: MouseEvent) => {
      const delta = ev.clientX - startX
      const pctDelta = (delta / totalW) * 100
      const newRatios = [...startRatios]
      if (dividerIdx === 0) {
        newRatios[0] = clamp(startRatios[0] + pctDelta, 20, 80 - newRatios[2])
        newRatios[1] = 100 - newRatios[0] - newRatios[2]
      } else {
        newRatios[1] = clamp(startRatios[1] + pctDelta, 20, 80 - newRatios[0])
        newRatios[2] = 100 - newRatios[0] - newRatios[1]
      }
      if (newRatios[1] >= 20) setCol3Ratios(newRatios)
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const startGridRowDrag = (dividerIdx: number, rowRatios: number[], e: React.MouseEvent) => {
    e.preventDefault()
    const container = containerRef.current
    if (!container) return
    const startY = e.clientY
    const startRatios = [...rowRatios]
    const totalH = container.clientHeight
    const onMove = (ev: MouseEvent) => {
      const delta = ev.clientY - startY
      const pctDelta = (delta / totalH) * 100
      const newRatios = [...startRatios]
      const pairTotal = startRatios[dividerIdx] + startRatios[dividerIdx + 1]
      const minRatio = Math.min(20, pairTotal / 2)
      newRatios[dividerIdx] = clamp(startRatios[dividerIdx] + pctDelta, minRatio, pairTotal - minRatio)
      newRatios[dividerIdx + 1] = pairTotal - newRatios[dividerIdx]
      setGridRowRatioState({ key: gridRowRatioKey, ratios: newRatios })
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const handleSwap = (sourceIdx: number, targetIdx: number) => {
    setCardOrder((prev) => {
      const syncedOrder = syncCardOrder(prev, currentGridNodeIds)
      if (
        sourceIdx === targetIdx ||
        sourceIdx < 0 ||
        targetIdx < 0 ||
        sourceIdx >= syncedOrder.length ||
        targetIdx >= syncedOrder.length
      ) {
        return prev
      }
      const next = [...syncedOrder]
      const tmp = next[sourceIdx]
      next[sourceIdx] = next[targetIdx]
      next[targetIdx] = tmp
      return next
    })
  }

  const cardProps = (node: Node, idx: number) => ({
    node, nodeTypes, idx, dragOverZone, setDragOverZone, handleDrop,
    swapDragSource,
    onGridDragStart: () => {
      setSwapDragSource(idx)
    },
    onGridDragEnd: () => {
      setDragOverZone(null)
      setSwapDragSource(null)
    },
    onSwapDrop: (targetIdx: number) => {
      const src = swapDragSource
      setDragOverZone(null)
      setSwapDragSource(null)
      if (src !== null) handleSwap(src, targetIdx)
    },
  })

  if (cardCount === 1) {
    return (
      <div ref={containerRef} style={{ width: '100%', height: '100%', padding: 8, background: '#f7f9fc' }}>
        <SplitCard key={orderedNodes[0].id} {...cardProps(orderedNodes[0], 0)} style={{ width: '100%', height: '100%' }} />
      </div>
    )
  }

  if (cardCount === 2 && !allXML) {
    return (
      <div ref={containerRef} style={{ display: 'flex', width: '100%', height: '100%', padding: 8, gap: 0, background: '#f7f9fc' }}>
        <SplitCard key={orderedNodes[0].id} {...cardProps(orderedNodes[0], 0)} style={{ width: `calc(${hRatio}% - 2px)`, height: '100%' }} />
        <SplitDivider direction="v" onMouseDown={startHDrag} />
        <SplitCard key={orderedNodes[1].id} {...cardProps(orderedNodes[1], 1)} style={{ width: `calc(${100 - hRatio}% - 2px)`, height: '100%' }} />
      </div>
    )
  }

  if (cardCount === 3 && !allXML) {
    return (
      <div ref={containerRef} style={{ display: 'flex', width: '100%', height: '100%', padding: 8, gap: 0, background: '#f7f9fc' }}>
        <SplitCard key={orderedNodes[0].id} {...cardProps(orderedNodes[0], 0)} style={{ width: `calc(${col3Ratios[0]}% - 3px)`, height: '100%' }} />
        <SplitDivider direction="v" onMouseDown={(e) => startCol3Drag(0, e)} />
        <SplitCard key={orderedNodes[1].id} {...cardProps(orderedNodes[1], 1)} style={{ width: `calc(${col3Ratios[1]}% - 3px)`, height: '100%' }} />
        <SplitDivider direction="v" onMouseDown={(e) => startCol3Drag(1, e)} />
        <SplitCard key={orderedNodes[2].id} {...cardProps(orderedNodes[2], 2)} style={{ width: `calc(${col3Ratios[2]}% - 2px)`, height: '100%' }} />
      </div>
    )
  }

  const gridTemplateColumns = allXML
    ? 'minmax(0, 1fr)'
    : hRatio === 50
    ? 'repeat(2, 1fr)'
    : `minmax(0, ${hRatio}fr) minmax(0, ${100 - hRatio}fr)`
  const rowCount = allXML ? cardCount : Math.ceil(cardCount / 2)
  const rowRatios = !allXML && rowCount === 2
    ? [vRatio, 100 - vRatio]
    : storedGridRowRatios.length === rowCount
      ? storedGridRowRatios
      : Array.from({ length: rowCount }, () => 100 / rowCount)
  const gridTemplateRows = rowRatios.map((ratio) => `minmax(0, ${ratio}fr)`).join(' ')
  const rowDividerPositions = rowRatios.slice(0, -1).reduce<number[]>((positions, ratio, idx) => {
    positions.push((positions[idx - 1] ?? 0) + ratio)
    return positions
  }, [])

  return (
    <div
      ref={containerRef}
      style={{
        position: 'relative',
        display: 'grid',
        gridTemplateColumns,
        gridTemplateRows,
        width: '100%',
        height: '100%',
        padding: 8,
        gap: 0,
        background: '#f7f9fc',
      }}
    >
      {orderedNodes.map((node, idx) => (
        <SplitCard
          key={node.id}
          {...cardProps(node, idx)}
          style={{
            width: '100%',
            height: '100%',
          }}
        />
      ))}
      {!allXML && (
        <div
          style={{
            position: 'absolute',
            top: 8,
            bottom: 8,
            left: `calc(${hRatio}% + ${6 - hRatio * 0.16}px)`,
            width: 4,
            zIndex: 5,
          }}
        >
          <SplitDivider direction="v" onMouseDown={startHDrag} />
        </div>
      )}
      {rowDividerPositions.map((position, idx) => (
        <div
          key={idx}
          style={{
            position: 'absolute',
            left: 8,
            right: 8,
            top: `calc(${position}% + ${6 - position * 0.16}px)`,
            height: 4,
            zIndex: 5,
          }}
        >
          <SplitDivider
            direction="h"
            onMouseDown={rowCount === 2 ? startVDrag : (e) => startGridRowDrag(idx, rowRatios, e)}
          />
        </div>
      ))}
    </div>
  )
}

function ViewerInner() {
  const params = useParams<{ sessionId?: string; groupId?: string }>()
  const { state, dispatch } = useViewer()

  const [tabs, setTabs] = useState<Tab[]>([{ id: 'tab-1', name: 'View 1', nodes: [], edges: [], chatMode: 'analysis' }])
  const [activeTabId, setActiveTabIdState] = useState('tab-1')
  const [chatStates, setChatStates] = useState<Record<string, Message[]>>({ 'tab-1': [] })
  const activeTabIdRef = useRef(activeTabId)

  const setActiveTabId = useCallback((id: string) => {
    activeTabIdRef.current = id
    setActiveTabIdState(id)
  }, [])

  useEffect(() => {
    activeTabIdRef.current = activeTabId
  }, [activeTabId])

  const activeTab = tabs.find(t => t.id === activeTabId)!

  const setNodes: React.Dispatch<React.SetStateAction<Node[]>> = useCallback((val) => {
    setTabs(prev => prev.map(t => t.id === activeTabId
      ? { ...t, nodes: typeof val === 'function' ? val(t.nodes) : val }
      : t
    ))
  }, [activeTabId])

  const setEdges: React.Dispatch<React.SetStateAction<Edge[]>> = useCallback((val) => {
    setTabs(prev => prev.map(t => t.id === activeTabId
      ? { ...t, edges: typeof val === 'function' ? val(t.edges) : val }
      : t
    ))
  }, [activeTabId])

  const setNodesForTab = useCallback((tabId: string, val: React.SetStateAction<Node[]>) => {
    setTabs(prev => prev.map(t => t.id === tabId
      ? { ...t, nodes: typeof val === 'function' ? val(t.nodes) : val }
      : t
    ))
  }, [])

  const { fitView, getViewport, addNodes, getNode } = useReactFlow()
  const nodeDimensionsRef = useRef<Map<string, NodeDimensions>>(new Map())
  const spawnCenterRequestsRef = useRef<Map<string, SpawnCenterRequest>>(new Map())
  const pendingViewportFocusRef = useRef<{ nodeId: string; tabId: string } | null>(null)
  const viewportFocusFrameRef = useRef<number | null>(null)

  const getCurrentNodeDimensions = useCallback((nodeId: string): NodeDimensions | null => {
    const tracked = nodeDimensionsRef.current.get(nodeId)
    if (tracked) return tracked

    const measured = getNode(nodeId)?.measured
    if (measured?.width && measured.height) {
      return { width: measured.width, height: measured.height }
    }

    return null
  }, [getNode])

  const positionSpawnNodeIfReady = useCallback((nodeId: string) => {
    const request = spawnCenterRequestsRef.current.get(nodeId)
    if (!request) return true
    if (request.positioned) return true
    if (!request.ready) return false

    const dimensions = getCurrentNodeDimensions(nodeId)
    if (!dimensions || !dimensionsMatchReadySize(dimensions, request.readyWidth)) return false

    request.positioned = true
    const position = {
      x: request.center.x - dimensions.width / 2,
      y: request.center.y - dimensions.height / 2,
    }

    setNodesForTab(request.tabId, (prev) =>
      prev.map((node) => (node.id === nodeId ? { ...node, position } : node))
    )

    return true
  }, [getCurrentNodeDimensions, setNodesForTab])

  const runPendingViewportFocus = useCallback(() => {
    viewportFocusFrameRef.current = null

    const focus = pendingViewportFocusRef.current
    if (!focus) return

    const request = spawnCenterRequestsRef.current.get(focus.nodeId)
    const wasPositioned = request?.positioned ?? true
    if (!positionSpawnNodeIfReady(focus.nodeId)) return

    if (!wasPositioned) {
      viewportFocusFrameRef.current = window.requestAnimationFrame(runPendingViewportFocus)
      return
    }

    const dimensions = getCurrentNodeDimensions(focus.nodeId)
    if (!dimensions || activeTabIdRef.current !== focus.tabId) {
      pendingViewportFocusRef.current = null
      if (request) spawnCenterRequestsRef.current.delete(focus.nodeId)
      return
    }

    pendingViewportFocusRef.current = null
    if (request) spawnCenterRequestsRef.current.delete(focus.nodeId)
    fitView({ nodes: [{ id: focus.nodeId }], padding: 0.3, duration: 400 })
  }, [fitView, getCurrentNodeDimensions, positionSpawnNodeIfReady])

  const scheduleViewportFocus = useCallback(() => {
    if (viewportFocusFrameRef.current !== null) return
    viewportFocusFrameRef.current = window.requestAnimationFrame(runPendingViewportFocus)
  }, [runPendingViewportFocus])

  const requestViewportFocus = useCallback((nodeId: string, tabId: string) => {
    pendingViewportFocusRef.current = { nodeId, tabId }
    scheduleViewportFocus()
  }, [scheduleViewportFocus])

  const requestSpawnCenter = useCallback((nodeId: string, tabId: string, center: { x: number; y: number }) => {
    spawnCenterRequestsRef.current.set(nodeId, {
      tabId,
      center,
      ready: false,
      positioned: false,
    })
    requestViewportFocus(nodeId, tabId)
  }, [requestViewportFocus])

  const handleNodeReadyForViewport = useCallback<NodeViewportReadyHandler>((nodeId, size) => {
    const request = spawnCenterRequestsRef.current.get(nodeId)
    if (!request) return

    request.ready = true
    request.readyWidth = size?.width
    const positioned = positionSpawnNodeIfReady(nodeId)
    if (positioned && pendingViewportFocusRef.current?.nodeId === nodeId) {
      scheduleViewportFocus()
    } else if (positioned) {
      spawnCenterRequestsRef.current.delete(nodeId)
    }
  }, [positionSpawnNodeIfReady, scheduleViewportFocus])

  useEffect(() => {
    return () => {
      if (viewportFocusFrameRef.current !== null) {
        window.cancelAnimationFrame(viewportFocusFrameRef.current)
      }
    }
  }, [])

  const nodes = activeTab.nodes
  const edges = activeTab.edges

  const onNodesChange = useCallback((changes: NodeChange<Node>[]) => {
    let shouldScheduleFocus = false

    for (const change of changes) {
      if (change.type === 'dimensions' && change.dimensions) {
        nodeDimensionsRef.current.set(change.id, change.dimensions)
        if (spawnCenterRequestsRef.current.has(change.id)) {
          const positioned = positionSpawnNodeIfReady(change.id)
          if (positioned && pendingViewportFocusRef.current?.nodeId === change.id) {
            shouldScheduleFocus = true
          } else if (positioned) {
            spawnCenterRequestsRef.current.delete(change.id)
          }
        } else if (pendingViewportFocusRef.current?.nodeId === change.id) {
          shouldScheduleFocus = true
        }
      } else if (change.type === 'remove') {
        nodeDimensionsRef.current.delete(change.id)
        spawnCenterRequestsRef.current.delete(change.id)
        if (pendingViewportFocusRef.current?.nodeId === change.id) {
          pendingViewportFocusRef.current = null
        }
      }
    }

    setTabs(prev => prev.map(t => t.id === activeTabId
      ? { ...t, nodes: dedupeNodesById(applyNodeChanges(changes, t.nodes)) }
      : t
    ))

    if (shouldScheduleFocus) scheduleViewportFocus()
  }, [activeTabId, positionSpawnNodeIfReady, scheduleViewportFocus])

  const onEdgesChange = useCallback((changes: EdgeChange<Edge>[]) => {
    setTabs(prev => prev.map(t => t.id === activeTabId
      ? { ...t, edges: applyEdgeChanges(changes, t.edges) }
      : t
    ))
  }, [activeTabId])

  const onConnect = useCallback(
    (connection: Connection) => setEdges((eds) => addEdge({ ...connection, animated: false, style: { stroke: '#94a3b8', strokeWidth: 2 }, data: { label: '' } }, eds)),
    [setEdges]
  )

  const addTab = useCallback(() => {
    const id = `tab-${Date.now()}`
    setTabs(prev => [...prev, { id, name: `View ${prev.length + 1}`, nodes: [], edges: [], chatMode: 'analysis' }])
    setChatStates(prev => ({ ...prev, [id]: [] }))
    setActiveTabId(id)
  }, [setActiveTabId])

  const closeTab = useCallback((id: string) => {
    setTabs(prev => {
      const next = prev.filter(t => t.id !== id)
      if (next.length === 0) return prev
      if (id === activeTabId) {
        setActiveTabId(next[next.length - 1].id)
      }
      return next
    })
  }, [activeTabId])

  const openAITab = useCallback(() => {
    const existing = tabs.find(t => t.isAutoAI)
    if (existing) {
      setTabs(prev => prev.map(t => t.id === existing.id ? { ...t, chatMode: 'autonomous' } : t))
      setActiveTabId(existing.id)
    } else {
      const id = `ai-${Date.now()}`
      setTabs(prev => [...prev, { id, name: 'AI Analysis', nodes: [], edges: [], chatMode: 'autonomous', isAutoAI: true }])
      setChatStates(prev => ({ ...prev, [id]: [] }))
      setActiveTabId(id)
    }
  }, [tabs, setActiveTabId])

  const handleChatModeChange = useCallback((chatMode: ChatMode) => {
    if (chatMode === 'autonomous') {
      openAITab()
      return
    }
    const targetTabId = activeTabIdRef.current
    setTabs(prev => prev.map(t => t.id === targetTabId ? { ...t, chatMode } : t))
  }, [openAITab])

  const chatMode = activeTab.chatMode
  const activeChatMessages = chatStates[activeTabId] ?? []
  const setActiveChatMessages = useCallback<React.Dispatch<React.SetStateAction<Message[]>>>((val) => {
    setChatStates(prev => {
      const current = prev[activeTabId] ?? []
      const next = typeof val === 'function' ? val(current) : val
      return { ...prev, [activeTabId]: next }
    })
  }, [activeTabId])
  const [sessions, setSessions] = useState<SessionMeta[]>([])
  const [sidebarWidth, setSidebarWidth] = useState(245)
  const dragging = useRef(false)
  const fileMetaRef = useRef<Map<string, { sessionId: string; nodeColor: string; file: FileRecord }>>(new Map())
  const clusterName =
    sessions.find((s) => s.clusterName)?.clusterName ||
    sessions.find((s) => s.clusterId)?.clusterId ||
    'PROD-01'

  const [groupSessions, setGroupSessions] = useState<{
    id: string
    color: string
    hostname?: string
    partnerHostname?: string
    serialNum?: string
    modelName?: string
    clusterName?: string
    generatedOn?: string
    status?: string
    aiSummary?: string
  }[]>([])

  const [templates, setTemplates] = useState<TemplateListItem[]>([])
  const [searchMode, setSearchMode] = useState(false)
  const [templateName, setTemplateName] = useState('')
  const [selectedTemplateId, setSelectedTemplateId] = useState('')
  const [templateMsg, setTemplateMsg] = useState<string | null>(null)
  const [templateMsgType, setTemplateMsgType] = useState<'success' | 'error' | 'info'>('info')
  const [editingEdgeId, setEditingEdgeId] = useState<string | null>(null)
  const [editingLabel, setEditingLabel] = useState('')
  const [activeSidePanel, setActiveSidePanel] = useState<'ai' | 'summary' | null>(null)
  const [aiAutoAnalysisEnabled, setAiAutoAnalysisEnabled] = useState<boolean | null>(null)
  const [aiPanelWidth, setAiPanelWidth] = useState(450)
  const [splitMode, setSplitMode] = useState(true)
  const [memoryUsed, setMemoryUsed] = useState<number | null>(null)

  useEffect(() => {
    getConfig()
      .then((res) => {
        setAiAutoAnalysisEnabled(Boolean(res.data?.ai_auto_analysis?.enabled ?? true))
      })
      .catch(() => setAiAutoAnalysisEnabled(true))
  }, [])

  useEffect(() => {
    const updateMemory = () => {
      const usedJSHeapSize = (performance as Performance & {
        memory?: { usedJSHeapSize?: number }
      }).memory?.usedJSHeapSize
      setMemoryUsed(typeof usedJSHeapSize === 'number' ? usedJSHeapSize : null)
    }

    updateMemory()
    const timer = window.setInterval(updateMemory, 5000)
    return () => window.clearInterval(timer)
  }, [])

  const totalCards = tabs.reduce((sum, t) => sum + t.nodes.length, 0)
  const memoryLabel = memoryUsed == null ? '—' : `${(memoryUsed / (1024 * 1024)).toFixed(1)} MB`
  const aiSummaries = sessions
    .map((s) => ({
      label: s.hostname || s.serialNum || s.sessionId,
      summary: (s.aiSummary || s.ai_summary || '').trim(),
    }))
    .filter((s) => s.summary)
  const aiSummarySections = Array.from(
    aiSummaries.reduce((groups, item) => {
      const summaries = groups.get(item.label) ?? []
      summaries.push(item.summary)
      groups.set(item.label, summaries)
      return groups
    }, new Map<string, string[]>())
  ).map(([label, summaries]) => ({ label, summaries }))
  const aiSummaryDisabled = aiAutoAnalysisEnabled === false || aiSummaries.length === 0
  const aiSummaryButtonTitle = aiAutoAnalysisEnabled === false
    ? 'AI analysis is disabled'
    : aiSummaries.length === 0
      ? 'AI summary is not ready'
      : 'Open AI summaries'
  const showAI = activeSidePanel === 'ai'
  const isAISummaryOpen = activeSidePanel === 'summary'
  const fontSize = state.fontSize || 13
  const setFontSize = useCallback((nextSize: number) => {
    dispatch({ type: 'SET_FONT_SIZE', fontSize: Math.max(10, Math.min(18, nextSize)) })
  }, [dispatch])

  useEffect(() => {
    async function load() {
      if (params.sessionId) {
        setGroupSessions([{ id: params.sessionId, color: nodeColorFor(0) }])
      } else if (params.groupId) {
        try {
          const res = await getSessionGroup(params.groupId)
          const members = res.data.members
          const entries = members.map((m: {
            session_id: string
            hostname?: string
            partner_hostname?: string
            serial_num?: string
            model_name?: string
            cluster_name?: string
            generated_on?: string
            status?: string
            ai_summary?: string
          }, i: number) => ({
            id: m.session_id,
            color: nodeColorFor(i),
            hostname: m.hostname,
            partnerHostname: m.partner_hostname,
            serialNum: m.serial_num,
            modelName: m.model_name,
            clusterName: m.cluster_name,
            generatedOn: m.generated_on,
            status: m.status,
            aiSummary: m.ai_summary,
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
    groupSessions.forEach(({ id, color, hostname, partnerHostname, serialNum, modelName, clusterName, generatedOn, status, aiSummary }) => {
      Promise.all([
        getSessionStatus(id).catch(() => null),
        getFiles(id),
      ]).then(([statusRes, filesRes]) => {
        const sessionData = statusRes?.data
        const files: FileRecord[] = filesRes.data?.files ?? filesRes.data ?? []
        const nonEmpty = files.filter((f) => !f.is_empty)
        const summary = aiSummary ?? sessionData?.ai_summary ?? ''

        const meta: SessionMeta = {
          sessionId: id,
          serialNum: serialNum ?? sessionData?.serial_num ?? '',
          modelName: modelName ?? sessionData?.model_name ?? '',
          model_name: modelName ?? sessionData?.model_name ?? '',
          generatedOn: generatedOn ?? sessionData?.generated_on ?? '',
          nodeColor: color,
          hostname: hostname ?? sessionData?.hostname ?? '',
          partnerHostname: partnerHostname ?? sessionData?.partner_hostname ?? '',
          status: status ?? sessionData?.status ?? '',
          fileCount: sessionData?.file_count,
          clusterId: sessionData?.cluster_id,
          clusterName: clusterName ?? sessionData?.cluster_name ?? '',
          cluster_name: clusterName ?? sessionData?.cluster_name ?? '',
          aiSummary: summary,
          ai_summary: summary,
        }

        setSessions((prev) => {
          const exists = prev.some((s) => s.sessionId === id)
          if (exists) {
            return prev.map((s) => s.sessionId === id ? { ...s, ...meta } : s)
          }
          return [...prev, meta]
        })
        dispatch({ type: 'UPSERT_SESSION', session: meta })

        const colorHex = color
        nonEmpty.forEach((f) => {
          fileMetaRef.current.set(f.id, { sessionId: id, nodeColor: colorHex, file: f })
        })

        dispatch({ type: 'SET_FILES', files: nonEmpty, sessionId: id, nodeColor: color })
      }).catch(console.error)
    })
  }, [groupSessions, dispatch])

  useEffect(() => {
    if (groupSessions.length === 0 || aiAutoAnalysisEnabled !== true) return

    let stopped = false
    let timer: number | undefined
    let attempts = 0
    const pending = new Set(groupSessions.map((s) => s.id))

    const applySummary = (sessionId: string, aiSummary: string) => {
      setSessions((prev) =>
        prev.map((s) =>
          s.sessionId === sessionId
            ? { ...s, aiSummary, ai_summary: aiSummary }
            : s
        )
      )
      dispatch({ type: 'UPDATE_SESSION_AI_SUMMARY', sessionId, aiSummary })
    }

    const poll = async () => {
      attempts += 1
      await Promise.all(
        Array.from(pending).map(async (sessionId) => {
          try {
            const res = await getAiSummary(sessionId)
            const summary = (res.data?.ai_summary ?? '').trim()
            if (summary) {
              applySummary(sessionId, summary)
              pending.delete(sessionId)
            } else if (attempts >= 12) {
              pending.delete(sessionId)
            }
          } catch {
            if (attempts >= 12) pending.delete(sessionId)
          }
        })
      )

      if (!stopped && pending.size > 0 && attempts < 12) {
        timer = window.setTimeout(poll, 5000)
      }
    }

    poll()
    return () => {
      stopped = true
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [groupSessions, dispatch, aiAutoAnalysisEnabled])

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
    (fileId: string) => {
      const targetTabId = activeTabIdRef.current
      dispatch({ type: 'SHOW_FILE', fileId })
      setNodesForTab(targetTabId, (prev) => {
        const existing = prev.find((n) => n.id === fileId)
        if (existing) {
          if (!splitMode) {
            requestViewportFocus(existing.id, targetTabId)
          }
          return prev
        }

        const meta = fileMetaRef.current.get(fileId)
        if (!meta) return prev

        if (splitMode) {
          const visibleNodesList = prev.filter((n) => !state.hiddenFileIds.has((n.data as { fileId: string }).fileId))
          // Add new card (up to grid max)
          if (visibleNodesList.length < SPLIT_GRID_MAX_CARDS) {
            const newNode = buildNode(meta.file, { x: 0, y: 0 }, meta.sessionId, meta.nodeColor, dispatch)
            return [...prev, newNode]
          }
          // Full: replace last
          const lastVisible = visibleNodesList[visibleNodesList.length - 1]
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

        const center = { x: cx + offset, y: cy + offset }
        const initialSize = initialCardSizeFor(meta.file)
        const position = {
          x: center.x - initialSize.width / 2,
          y: center.y - initialSize.height / 2,
        }
        const newNode = buildNode(meta.file, position, meta.sessionId, meta.nodeColor, dispatch, handleNodeReadyForViewport)
        requestSpawnCenter(newNode.id, targetTabId, center)
        return [...prev, newNode]
      })
    },
    [
      getViewport,
      sidebarWidth,
      dispatch,
      splitMode,
      state.hiddenFileIds,
      setNodesForTab,
      handleNodeReadyForViewport,
      requestSpawnCenter,
      requestViewportFocus,
    ]
  )

  const handleSpawnCard = useCallback((fileId: string, replaceNodeId?: string) => {
    const targetTabId = activeTabIdRef.current
    dispatch({ type: 'SHOW_FILE', fileId })

    const meta = fileMetaRef.current.get(fileId)
    if (!meta) return null

    const existing = nodes.find((node) => node.id === fileId)
    const target = replaceNodeId ? nodes.find((node) => node.id === replaceNodeId) : undefined

    if (existing) {
      setNodesForTab(targetTabId, (prev) => {
        if (!replaceNodeId || replaceNodeId === existing.id) return prev
        return prev.filter((node) => node.id !== replaceNodeId)
      })
      return existing.id
    }

    const visibleNodesList = nodes.filter((node) => !state.hiddenFileIds.has((node.data as { fileId: string }).fileId))
    const fallbackTarget = visibleNodesList.length >= SPLIT_GRID_MAX_CARDS
      ? visibleNodesList[visibleNodesList.length - 1]
      : undefined
    const targetNode = target ?? fallbackTarget
    const newNode = buildNode(
      meta.file,
      targetNode?.position ?? { x: 0, y: 0 },
      meta.sessionId,
      meta.nodeColor,
      dispatch
    )

    addNodes(newNode)

    setNodesForTab(targetTabId, (prev) => {
      if (prev.some((node) => node.id === newNode.id)) return prev

      if (targetNode && prev.some((node) => node.id === targetNode.id)) {
        return prev.map((node) => (node.id === targetNode.id ? newNode : node))
      }

      return [...prev, newNode]
    })

    return newNode.id
  }, [addNodes, dispatch, nodes, setNodesForTab, state.hiddenFileIds])

  const handleDuplicateCard = useCallback((node: Node) => {
    const nodeId = typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : 'dup-' + Math.random().toString(36).slice(2) + Date.now().toString(36)
    const sourceData = node.data as Record<string, unknown> & {
      filename?: string
      collapsed?: boolean
    }
    const filename = typeof sourceData.filename === 'string' ? sourceData.filename : node.id

    const newNode: Node = {
      ...node,
      id: nodeId,
      hidden: false,
      selected: false,
      dragging: false,
      position: {
        x: node.position.x + 30,
        y: node.position.y + 30,
      },
      data: {
        ...sourceData,
        filename: `[Duplicate] ${filename}`,
        collapsed: Boolean(sourceData.collapsed),
        __duplicate: true,
        onCollapse: () => {
          setNodesForTab(activeTabIdRef.current, (prev) =>
            prev.map((current) =>
              current.id === nodeId
                ? {
                    ...current,
                    data: {
                      ...current.data,
                      collapsed: !(current.data as { collapsed?: boolean }).collapsed,
                    },
                  }
                : current
            )
          )
        },
        onHide: () => {
          setNodesForTab(activeTabIdRef.current, (prev) =>
            prev.map((current) => current.id === nodeId ? { ...current, hidden: true } : current)
          )
        },
        onDuplicate: () => {},
      },
    }

    addNodes(newNode)

    if (splitMode) {
      setNodesForTab(activeTabIdRef.current, (prev) =>
        prev.some((current) => current.id === nodeId) ? prev : [...prev, newNode]
      )
    }
  }, [addNodes, setNodesForTab, splitMode])

  const onEdgeDoubleClick = useCallback((event: React.MouseEvent, edge: Edge) => {
    event.stopPropagation()
    setEditingEdgeId(edge.id)
    setEditingLabel((edge.data as { label?: string } | undefined)?.label ?? '')
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
      splitMode,
      split_mode: splitMode,
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
        split_mode: splitMode,
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
      const templateSplitMode = Boolean(
        res.data.split_mode ?? res.data.splitMode ?? cards.some((card: TemplateCard) => card.splitMode || card.split_mode)
      )
      setSplitMode(templateSplitMode)

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
              const colorHex = session?.color ?? nodeColorFor(0)
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
        const data = n.data as {
          fileId: string
          collapsed?: boolean
          __duplicate?: boolean
          onCollapse?: () => void
          onHide?: () => void
          sessionId?: string
        }
        const fileId = data.fileId
        const sessionId = data.sessionId
        const aiSummary = sessionId
          ? (state.sessions.find((s) => s.sessionId === sessionId)?.aiSummary ||
            state.sessions.find((s) => s.sessionId === sessionId)?.ai_summary ||
            '')
          : ''
        const isDuplicate = data.__duplicate === true
        const hidden = isDuplicate ? Boolean(n.hidden) : state.hiddenFileIds.has(fileId)
        const collapsed = isDuplicate ? Boolean(data.collapsed) : state.collapsedFileIds.has(fileId)
        const nodeWithState = { ...n, hidden, data: { ...n.data, collapsed, aiSummary } }

        return {
          ...nodeWithState,
          data: {
            ...nodeWithState.data,
            onCollapse: isDuplicate
              ? () => {
                  setNodesForTab(activeTabIdRef.current, (prev) =>
                    prev.map((current) =>
                      current.id === n.id
                        ? {
                            ...current,
                            data: {
                              ...current.data,
                              collapsed: !(current.data as { collapsed?: boolean }).collapsed,
                            },
                          }
                        : current
                    )
                  )
                }
              : data.onCollapse,
            onHide: isDuplicate
              ? () => {
                  setNodesForTab(activeTabIdRef.current, (prev) =>
                    prev.map((current) => current.id === n.id ? { ...current, hidden: true } : current)
                  )
                }
              : data.onHide,
            onDuplicate: () => handleDuplicateCard(nodeWithState),
          },
        }
      }),
    [nodes, state.hiddenFileIds, state.collapsedFileIds, state.sessions, handleDuplicateCard, setNodesForTab]
  )

  const tabFileIds = useMemo(
    () =>
      nodes
        .filter((n) => (n.data as { __duplicate?: boolean }).__duplicate !== true)
        .map((n) => (n.data as { fileId?: string }).fileId)
        .filter((fileId): fileId is string => typeof fileId === 'string' && !state.hiddenFileIds.has(fileId)),
    [nodes, state.hiddenFileIds]
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

        {/* Toolbar */}
        <div className="toolbar nodrag" style={{
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
            ✕ Clear Canvas
          </button>
          <div style={{ width: 1, height: 16, background: '#e2e8f0' }} />
          <button
            onClick={() => setSplitMode(!splitMode)}
            title={splitMode ? 'Switch to canvas mode' : 'Switch to grid mode'}
            style={{
              background: 'none', border: '1px solid #e2e8f0', borderRadius: 4,
              color: splitMode ? '#3b82f6' : '#94a3b8', cursor: 'pointer', padding: '3px 8px',
              fontSize: 11, fontFamily: 'ui-monospace, Consolas, monospace',
            }}
          >
            ⊞ Grid
          </button>
          <div style={{ width: 1, height: 16, background: '#e2e8f0' }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ color: '#64748b', fontSize: 11, fontFamily: 'ui-monospace, Consolas, monospace' }}>Font Size:</span>
            <button
              type="button"
              onClick={() => setFontSize(fontSize - 1)}
              title="Decrease font size"
              style={toolbarBtnStyle}
            >
              -
            </button>
            <span style={{ minWidth: 18, textAlign: 'center', color: '#64748b', fontSize: 11, fontFamily: 'ui-monospace, Consolas, monospace' }}>
              {fontSize}
            </span>
            <button
              type="button"
              onClick={() => setFontSize(fontSize + 1)}
              title="Increase font size"
              style={toolbarBtnStyle}
            >
              +
            </button>
          </div>
          <div style={{ flex: 1 }} />
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
          <div style={{ width: 1, height: 16, background: '#e2e8f0' }} />
          <button
            type="button"
            aria-pressed={showAI}
            onClick={() => setActiveSidePanel((panel) => panel === 'ai' ? null : 'ai')}
            style={{
              background: showAI ? '#eff6ff' : chatMode === 'autonomous' ? '#eff6ff' : '#fff',
              border: `1px solid ${showAI ? '#3b82f6' : chatMode === 'autonomous' ? '#3b82f6' : '#e2e8f0'}`,
              borderRadius: 4,
              color: showAI ? '#1d4ed8' : chatMode === 'autonomous' ? '#1d4ed8' : '#475569',
              cursor: 'pointer',
              padding: '3px 8px',
              fontSize: 11,
              fontWeight: 500,
              fontFamily: 'system-ui, -apple-system, sans-serif',
            }}
          >
            {chatMode === 'analysis' ? '🔍 AI Analysis' : '🤖 AI Auto'}
          </button>
          <button
            type="button"
            aria-pressed={isAISummaryOpen}
            title={aiSummaryButtonTitle}
            disabled={aiSummaryDisabled}
            onClick={() => {
              if (!aiSummaryDisabled) {
                setActiveSidePanel((panel) => panel === 'summary' ? null : 'summary')
              }
            }}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              background: aiSummaryDisabled ? '#fff' : isAISummaryOpen ? '#eff6ff' : '#fff',
              border: `1px solid ${aiSummaryDisabled ? '#e2e8f0' : isAISummaryOpen ? '#3b82f6' : '#e2e8f0'}`,
              borderRadius: 4,
              color: aiSummaryDisabled ? '#94a3b8' : isAISummaryOpen ? '#1d4ed8' : '#475569',
              cursor: aiSummaryDisabled ? 'not-allowed' : 'pointer',
              padding: '3px 8px',
              fontSize: 11,
              fontWeight: 500,
              fontFamily: 'system-ui, -apple-system, sans-serif',
              maxWidth: 220,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            💡 Insight {aiSummaries.length}
          </button>
        </div>

        <TabBar tabs={tabs} activeTabId={activeTabId} onSelect={setActiveTabId} onAdd={addTab} onClose={closeTab} />

        <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
          {/* Canvas or Split Grid */}
          <div className="viewer-canvas" style={{ flex: 1 }}>
            {!splitMode && (
            <ReactFlow
              key={activeTabId}
              nodes={visibleNodes}
              edges={edges}
              nodeTypes={nodeTypes}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onEdgeDoubleClick={onEdgeDoubleClick}
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
            {splitMode && <SplitGrid nodes={visibleNodes.filter(n => !n.hidden)} nodeTypes={nodeTypes} onSpawnCard={handleSpawnCard} />}
          </div>

          {/* AI Side Panel */}
          {activeSidePanel && (
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
                {showAI ? (
                  <AIChatPanel
                    sessionIds={groupSessions.map(s => s.id)}
                    mode={chatMode}
                    onModeChange={handleChatModeChange}
                    onFocusFile={handleFocusFile}
                    tabFileIds={tabFileIds}
                    onClose={() => setActiveSidePanel(null)}
                    messages={activeChatMessages}
                    onMessagesChange={setActiveChatMessages}
                  />
                ) : (
                  <AISummaryPanel
                    sections={aiSummarySections}
                    onClose={() => setActiveSidePanel(null)}
                  />
                )}
              </div>
            </>
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

        <div
          style={{
            height: 28,
            background: '#f1f5f9',
            borderTop: '1px solid #e2e8f0',
            fontSize: 11,
            fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace',
            color: '#64748b',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 16px',
            boxSizing: 'border-box',
            whiteSpace: 'nowrap',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, minWidth: 0 }}>
            <span>{activeTab.name}</span>
            <span>Cards: {nodes.length}</span>
            <span>Total: {totalCards}</span>
            <span>Memory: {memoryLabel}</span>
            <span style={{ color: splitMode ? '#3b82f6' : undefined }}>Grid</span>
          </div>
          <TipsTicker />
        </div>
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

const toolbarBtnStyle: React.CSSProperties = {
  background: 'none',
  border: '1px solid #e2e8f0',
  borderRadius: 4,
  color: '#94a3b8',
  cursor: 'pointer',
  padding: '3px 8px',
  fontSize: 11,
  fontFamily: 'ui-monospace, Consolas, monospace',
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
