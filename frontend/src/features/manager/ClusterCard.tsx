import { useState } from 'react'
import NodeRow from './NodeRow'
import type { Cluster } from '../../types'

interface ClusterCardProps {
  cluster: Cluster
}

export default function ClusterCard({ cluster }: ClusterCardProps) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div
      style={{
        background: '#ffffff',
        border: '1px solid #e2e8f0',
        borderRadius: 8,
        overflow: 'hidden',
        marginBottom: 12,
      }}
    >
      <div
        onClick={() => setExpanded((v) => !v)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '12px 16px',
          cursor: 'pointer',
          userSelect: 'none',
        }}
      >
        <span style={{ color: '#94a3b8', fontSize: 12 }}>{expanded ? '▼' : '▶'}</span>
        <span
          style={{
            fontFamily: 'ui-monospace, Consolas, monospace',
            fontSize: 13,
            color: '#1e293b',
            flex: 1,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {cluster.id}
        </span>
        <span
          style={{
            fontSize: 11,
            color: '#64748b',
            background: '#f1f5f9',
            border: '1px solid #e2e8f0',
            borderRadius: 4,
            padding: '2px 8px',
          }}
        >
          {cluster.node_count} node{cluster.node_count !== 1 ? 's' : ''}
        </span>
      </div>

      {expanded && cluster.nodes?.length > 0 && (
        <div
          style={{
            borderTop: '1px solid #e2e8f0',
            padding: '10px 16px',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          {cluster.nodes.map((node) => (
            <NodeRow
              key={node.id}
              clusterId={cluster.id}
              nodeId={node.id}
              serialNum={node.serial_num}
              osVersion={''}
              sessionCount={node.session_count}
            />
          ))}
        </div>
      )}

      {expanded && (!cluster.nodes || cluster.nodes.length === 0) && (
        <div
          style={{
            borderTop: '1px solid #e2e8f0',
            padding: '12px 16px',
            color: '#94a3b8',
            fontSize: 13,
          }}
        >
          No nodes
        </div>
      )}
    </div>
  )
}
