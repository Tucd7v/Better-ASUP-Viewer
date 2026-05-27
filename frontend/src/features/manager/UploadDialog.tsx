import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { uploadFile } from '../../services/api'

interface UploadDialogProps {
  onClose: () => void
}

type Stage = 'idle' | 'uploading' | 'processing' | 'done' | 'error'

export default function UploadDialog({ onClose }: UploadDialogProps) {
  const navigate = useNavigate()
  const [file, setFile] = useState<File | null>(null)
  const [stage, setStage] = useState<Stage>('idle')
  const [progress, setProgress] = useState(0)
  const [stageText, setStageText] = useState('')
  const [errorMsg, setErrorMsg] = useState('')
  const [draggingOver, setDraggingOver] = useState(false)

  const accepted = ['.7z', '.tar', '.tgz', '.gz']

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDraggingOver(false)
    const f = e.dataTransfer.files[0]
    if (f) setFile(f)
  }

  const handleSubmit = async () => {
    if (!file) return
    setStage('uploading')
    setProgress(10)
    setStageText('Uploading…')
    console.log('[Upload] submitting file:', file.name, file.size, 'bytes')
    try {
      const res = await uploadFile(file)
      console.log('[Upload] POST /upload response:', res.status, res.data)
      const sessionId: string = res.data.session_id ?? res.data.id
      setProgress(30)
      setStage('processing')
      setStageText('Processing…')

      const sseUrl = `/api/v1/sessions/${sessionId}/progress`
      console.log('[Upload] opening SSE:', sseUrl)
      const es = new EventSource(sseUrl)

      es.addEventListener('progress', (ev) => {
        try {
          const d = JSON.parse(ev.data)
          console.log('[SSE] progress:', d)
          if (d.percent !== undefined) setProgress(d.percent)
          if (d.stage) setStageText(d.stage)
        } catch { /* ignore */ }
      })

      es.addEventListener('done', (ev) => {
        console.log('[SSE] done:', ev.data)
        es.close()
        setStage('done')
        setProgress(100)
        navigate(`/viewer/${sessionId}`)
      })

      es.addEventListener('error', (ev) => {
        try {
          const d = JSON.parse((ev as MessageEvent).data)
          console.error('[SSE] error event:', d)
          es.close()
          setStage('error')
          setErrorMsg(d.message ?? 'Processing failed')
        } catch {
          console.error('[SSE] error event (unparseable):', ev)
        }
      })

      es.onmessage = (ev) => {
        console.log('[SSE] unnamed message:', ev.data)
      }

      es.onerror = (ev) => {
        console.error('[SSE] connection error:', ev, 'readyState:', es.readyState)
        if (es.readyState === EventSource.CLOSED) {
          navigate(`/viewer/${sessionId}`)
        }
      }
    } catch (err: unknown) {
      console.error('[Upload] fetch error:', err)
      setStage('error')
      const msg = err instanceof Error ? err.message : 'Upload failed'
      setErrorMsg(msg)
    }
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(15,23,42,0.4)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        style={{
          background: '#ffffff',
          border: '1px solid #e2e8f0',
          borderRadius: 12,
          padding: 28,
          width: 440,
          maxWidth: '90vw',
          boxShadow: '0 8px 32px rgba(0,0,0,0.12)',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 20,
          }}
        >
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: '#1e293b' }}>
            Upload ASUP File
          </h2>
          <button onClick={onClose} style={closeBtnStyle}>
            ×
          </button>
        </div>

        {stage === 'idle' || stage === 'error' ? (
          <>
            <div
              onDrop={handleDrop}
              onDragOver={(e) => {
                e.preventDefault()
                setDraggingOver(true)
              }}
              onDragLeave={() => setDraggingOver(false)}
              onClick={() => document.getElementById('file-input')?.click()}
              style={{
                border: `2px dashed ${draggingOver ? '#3b82f6' : '#cbd5e1'}`,
                borderRadius: 8,
                padding: '32px 20px',
                textAlign: 'center',
                cursor: 'pointer',
                background: draggingOver ? 'rgba(59,130,246,0.05)' : '#f8fafc',
                transition: 'all 0.15s',
                marginBottom: 16,
              }}
            >
              <div style={{ fontSize: 32, marginBottom: 8 }}>📁</div>
              <div style={{ color: '#64748b', fontSize: 14, marginBottom: 4 }}>
                {file ? file.name : 'Drop file here or click to browse'}
              </div>
              <div style={{ color: '#94a3b8', fontSize: 12 }}>
                Accepts: .7z .tar .tgz .tar.gz .gz
              </div>
              <input
                id="file-input"
                type="file"
                accept={accepted.join(',')}
                style={{ display: 'none' }}
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) setFile(f)
                }}
              />
            </div>

            {stage === 'error' && (
              <div
                style={{
                  background: 'rgba(239,68,68,0.06)',
                  border: '1px solid rgba(239,68,68,0.25)',
                  borderRadius: 6,
                  padding: '8px 12px',
                  color: '#dc2626',
                  fontSize: 13,
                  marginBottom: 16,
                }}
              >
                {errorMsg}
              </div>
            )}

            <button
              onClick={handleSubmit}
              disabled={!file}
              style={{
                width: '100%',
                padding: '10px',
                background: file ? '#3b82f6' : '#e2e8f0',
                border: 'none',
                borderRadius: 6,
                color: file ? '#fff' : '#94a3b8',
                fontSize: 14,
                fontWeight: 600,
                cursor: file ? 'pointer' : 'not-allowed',
                transition: 'background 0.15s',
              }}
            >
              Upload
            </button>
          </>
        ) : (
          <div>
            <div style={{ color: '#475569', fontSize: 13, marginBottom: 12 }}>
              {stageText}
            </div>
            <div
              style={{
                background: '#f1f5f9',
                borderRadius: 4,
                overflow: 'hidden',
                height: 8,
                marginBottom: 8,
              }}
            >
              <div
                style={{
                  height: '100%',
                  width: `${progress}%`,
                  background: '#3b82f6',
                  transition: 'width 0.3s',
                  borderRadius: 4,
                }}
              />
            </div>
            <div style={{ color: '#94a3b8', fontSize: 12, textAlign: 'right' }}>
              {progress}%
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

const closeBtnStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: '#94a3b8',
  cursor: 'pointer',
  fontSize: 20,
  lineHeight: 1,
  padding: '0 4px',
}
