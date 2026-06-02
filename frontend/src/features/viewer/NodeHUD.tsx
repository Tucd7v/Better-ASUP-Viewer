import type { SessionMeta } from '../../types'

interface NodeHUDProps {
  sessions: SessionMeta[]
}

export default function NodeHUD({ sessions }: NodeHUDProps) {
  const rows = sessions.length
    ? sessions
    : [{ sessionId: '', serialNum: '', generatedOn: '', nodeColor: '#3b82f6', hostname: 'NodeA', status: 'healthy' }]

  const primary = rows[0]
  const clusterLabel = primary?.clusterId || 'PROD-01'
  const asupTime = rows.find((s) => s.generatedOn)?.generatedOn ?? ''
  const multiNode = rows.length > 2

  return (
    <div
      className="node-hud-bar"
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        flexWrap: 'wrap', padding: '4px 12px', minHeight: 28,
        background: '#ffffff', borderBottom: '1px solid #e2e8f0',
        fontSize: 11, fontFamily: 'ui-monospace, Consolas, monospace',
      }}
    >
      <span style={{ color: '#64748b', fontWeight: 500 }}>Cluster:</span>
      <span style={{ color: '#1e293b', fontWeight: 600 }}>{clusterLabel}</span>

      {multiNode ? (
        <div style={{
          display: 'flex', flexDirection: 'column', gap: 1,
          marginLeft: 16, padding: '2px 0',
        }}>
          {rows.map((session, i) => (
            <div key={session.sessionId || i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span
                style={{
                  width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                  backgroundColor: session.nodeColor || '#3b82f6',
                }}
              />
              <span style={{ color: '#475569' }}>{session.hostname || `Node${i + 1}`}</span>
              <span style={{ color: '#94a3b8', fontSize: 10 }}>
                {shortSerial(session.serialNum || session.sessionId)}
              </span>
            </div>
          ))}
        </div>
      ) : (
        rows.map((session, i) => (
          <div key={session.sessionId || i} style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: i > 0 ? 12 : 0 }}>
            <span
              style={{
                width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                backgroundColor: session.nodeColor || (i === 0 ? '#3b82f6' : '#f97316'),
              }}
            />
            <span style={{ color: '#1e293b', fontWeight: 500 }}>{session.hostname || `Node${i + 1}`}</span>
            <span style={{ color: '#94a3b8', fontSize: 10 }}>
              {shortSerial(session.serialNum || session.sessionId)}
            </span>
          </div>
        ))
      )}

      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ color: '#64748b' }}>ASUP:</span>
        <span style={{ color: '#94a3b8' }}>{formatDate(asupTime)}</span>
      </div>
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
  } catch { return iso }
}

function shortSerial(value: string): string {
  if (!value) return '—'
  return value.length > 13 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value
}
