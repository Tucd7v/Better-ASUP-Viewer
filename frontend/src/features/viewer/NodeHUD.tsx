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
        background: 'rgba(255,255,255,0.85)',
        backdropFilter: 'blur(8px)',
        borderRadius: '0.75rem',
        padding: '10px 14px',
        fontFamily: 'ui-monospace, Consolas, monospace',
        fontSize: '0.75rem',
        color: '#1e293b',
        minWidth: 180,
        border: '1px solid #e2e8f0',
        boxShadow: '0 1px 6px rgba(0,0,0,0.08)',
      }}
    >
      {sessions.length === 1 ? (
        <div>
          <div style={{ color: '#64748b', marginBottom: 2 }}>
            🖥 SN: <span style={{ color: '#1e293b' }}>{sessions[0].serialNum || '—'}</span>
          </div>
          <div style={{ color: '#64748b' }}>
            {formatDate(sessions[0].generatedOn)}
          </div>
        </div>
      ) : (
        sessions.map((s, i) => (
          <div key={s.sessionId}>
            {i > 0 && (
              <div style={{ borderTop: '1px solid #e2e8f0', margin: '6px 0' }} />
            )}
            <div style={{ color: '#64748b', marginBottom: 2 }}>
              {i === 0 ? '🔵' : '🟠'} SN:{' '}
              <span style={{ color: '#1e293b' }}>{s.serialNum || '—'}</span>
            </div>
            <div style={{ color: '#64748b' }}>{formatDate(s.generatedOn)}</div>
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
