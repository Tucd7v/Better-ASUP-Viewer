import type { SessionMeta } from '../../types'

interface NodeHUDProps {
  sessions: SessionMeta[]
  onClearCanvas?: () => void
}

const NODE_COLORS = {
  blue: '#3b82f6',
  orange: '#f97316',
} as const

export default function NodeHUD({ sessions, onClearCanvas }: NodeHUDProps) {
  const rows = sessions.length
    ? sessions
    : [
        {
          sessionId: '',
          serialNum: '',
          generatedOn: '',
          nodeColor: 'blue' as const,
          hostname: 'NodeA',
          status: 'healthy',
        },
      ]

  const primary = rows[0]
  const clusterLabel = primary?.clusterId || 'PROD-01'
  const asupTime = rows.find((s) => s.generatedOn)?.generatedOn ?? ''

  return (
    <div className="node-hud-bar">
      <div className="hud-cluster">
        <span className="hud-label">Cluster:</span>
        <span className="hud-cluster-name">{clusterLabel}</span>
      </div>

      {rows.slice(0, 2).map((session, index) => {
        const color = session.nodeColor ?? (index === 0 ? 'blue' : 'orange')
        const nodeName = session.hostname || (index === 0 ? 'NodeA' : 'NodeB')
        return (
          <div className="hud-node" key={session.sessionId || nodeName}>
            <span
              className="hud-node-dot"
              style={{ backgroundColor: NODE_COLORS[color] }}
            />
            <span className="hud-node-name">{nodeName}</span>
            <span className="hud-node-serial">{shortSerial(session.serialNum || session.sessionId)}</span>
          </div>
        )
      })}

      <div className="hud-asup">
        <span className="hud-label">ASUP:</span>
        <span>{formatDate(asupTime)}</span>
      </div>

      {onClearCanvas && (
        <button
          onClick={onClearCanvas}
          style={{
            marginLeft: 'auto', background: 'none', border: '1px solid #e2e8f0',
            borderRadius: 4, color: '#94a3b8', cursor: 'pointer', padding: '2px 10px',
            fontSize: 11, fontFamily: 'system-ui, -apple-system, sans-serif',
          }}
          title="关闭所有卡片"
        >
          ✕ Clear
        </button>
      )}
    </div>
  )
}

function formatDate(iso: string): string {
  if (!iso) return '—'
  try {
    const d = new Date(iso)
    const yyyy = d.getFullYear()
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    const dd = String(d.getDate()).padStart(2, '0')
    const hh = String(d.getHours()).padStart(2, '0')
    const min = String(d.getMinutes()).padStart(2, '0')
    return `${yyyy}-${mm}-${dd} ${hh}:${min}`
  } catch {
    return iso
  }
}

function shortSerial(value: string): string {
  if (!value) return '—'
  return value.length > 13 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value
}
