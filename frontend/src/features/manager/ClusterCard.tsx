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
        background: '#1e1e2e',
        border: '1px solid #2a2a3e',
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
        <span style={{ color: '#64748b', fontSize: 12 }}>{expanded ? '▼' : '▶'}</span>
        <span
          style={{
            fontFamily: 'ui-monospace, Consolas, monospace',
            fontSize: 13,
            color: '#e2e8f0',
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
            background: '#0f0f1a',
            border: '1px solid #2a2a3e',
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
            borderTop: '1px solid #2a2a3e',
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
            borderTop: '1px solid #2a2a3e',
            padding: '12px 16px',
            color: '#475569',
            fontSize: 13,
          }}
        >
          No nodes
        </div>
      )}
    </div>
  )
}
