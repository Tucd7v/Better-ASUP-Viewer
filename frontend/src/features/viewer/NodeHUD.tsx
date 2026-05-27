import type { SessionMeta } from '../../types'

interface NodeHUDProps {
  sessions: SessionMeta[]
}

export default function NodeHUD({ sessions }: NodeHUDProps) {
  return (
    <div
      style={{
        position: 'absolute',
        top: 12,
        left: 12,
        zIndex: 10,
        pointerEvents: 'none',
        background: 'rgba(0,0,0,0.45)',
        backdropFilter: 'blur(8px)',
        borderRadius: '0.75rem',
        padding: '10px 14px',
        fontFamily: 'ui-monospace, Consolas, monospace',
        fontSize: '0.75rem',
        color: '#e2e8f0',
        minWidth: 180,
      }}
    >
      {sessions.length === 1 ? (
        <div>
          <div style={{ color: '#94a3b8', marginBottom: 2 }}>
            🖥 SN: <span style={{ color: '#e2e8f0' }}>{sessions[0].serialNum || '—'}</span>
          </div>
          <div style={{ color: '#94a3b8' }}>
            {formatDate(sessions[0].generatedOn)}
          </div>
        </div>
      ) : (
        sessions.map((s, i) => (
          <div key={s.sessionId}>
            {i > 0 && (
              <div style={{ borderTop: '1px solid rgba(255,255,255,0.15)', margin: '6px 0' }} />
            )}
            <div style={{ color: '#94a3b8', marginBottom: 2 }}>
              {i === 0 ? '🔵' : '🟠'} SN:{' '}
              <span style={{ color: '#e2e8f0' }}>{s.serialNum || '—'}</span>
            </div>
            <div style={{ color: '#94a3b8' }}>{formatDate(s.generatedOn)}</div>
          </div>
        ))
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
