import { useState } from 'react'
import { uploadFile } from '../../services/api'

interface UploadDialogProps {
  onClose: () => void
  onDone?: () => void
}

type Stage = 'idle' | 'uploading' | 'processing' | 'done' | 'error'

export default function UploadDialog({ onClose, onDone }: UploadDialogProps) {
  const [files, setFiles] = useState<File[]>([])
  const [stage, setStage] = useState<Stage>('idle')
  const [progress, setProgress] = useState(0)
  const [stageText, setStageText] = useState('')
  const [errorMsg, setErrorMsg] = useState('')
  const [draggingOver, setDraggingOver] = useState(false)
  const [currentIndex, setCurrentIndex] = useState(0)

  const accepted = ['.7z', '.tar', '.tgz', '.gz']

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDraggingOver(false)
    const dropped = Array.from(e.dataTransfer.files)
    if (dropped.length > 0) setFiles(dropped)
  }

  const handleSubmit = async () => {
    if (files.length === 0) return
    setStage('uploading')
    setProgress(0)
    setCurrentIndex(0)
    setStageText('Uploading…')
    try {
      for (let i = 0; i < files.length; i++) {
        setCurrentIndex(i)
        await uploadOneFile(files[i], i, files.length)
      }
      setStage('done')
      setProgress(100)
      setStageText('Done!')
      setTimeout(() => { onDone?.(); onClose() }, 800)
    } catch (err: unknown) {
      console.error('[Upload] fetch error:', err)
      setStage('error')
      const msg = err instanceof Error ? err.message : 'Upload failed'
      setErrorMsg(msg)
    }
  }

  const uploadOneFile = async (file: File, index: number, total: number) => {
    setStage('uploading')
    setStageText(`Uploading ${index + 1}/${total}: ${file.name}`)
    setProgress(overallProgress(index, total, 10))
    console.log('[Upload] submitting file:', file.name, file.size, 'bytes')

    const res = await uploadFile(file)
    console.log('[Upload] POST /upload response:', res.status, res.data)
    const sessionId: string = res.data.session_id ?? res.data.id

    setStage('processing')
    setStageText(`Processing ${index + 1}/${total}: ${file.name}`)
    setProgress(overallProgress(index, total, 30))

    await waitForProcessing(sessionId, file.name, index, total)
  }

  const waitForProcessing = (
    sessionId: string,
    filename: string,
    index: number,
    total: number
  ) =>
    new Promise<void>((resolve, reject) => {
      const sseUrl = `/api/v1/sessions/${sessionId}/progress`
      console.log('[Upload] opening SSE:', sseUrl)
      const es = new EventSource(sseUrl)

      es.addEventListener('progress', (ev) => {
        try {
          const d = JSON.parse(ev.data)
          console.log('[SSE] progress:', d)
          if (d.percent !== undefined) {
            setProgress(overallProgress(index, total, d.percent))
          }
          if (d.stage) setStageText(`${index + 1}/${total} ${filename}: ${d.stage}`)
        } catch { /* ignore */ }
      })

      es.addEventListener('done', (ev) => {
        console.log('[SSE] done:', ev.data)
        es.close()
        setProgress(overallProgress(index, total, 100))
        resolve()
      })

      es.addEventListener('error', (ev) => {
        try {
          const d = JSON.parse((ev as MessageEvent).data)
          console.error('[SSE] error event:', d)
          es.close()
          reject(new Error(d.message ?? 'Processing failed'))
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
          resolve()
        }
      }
    })

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
                {files.length > 0
                  ? `${files.length} file${files.length > 1 ? 's' : ''} selected`
                  : 'Drop files here or click to browse'}
              </div>
              <div style={{ color: '#94a3b8', fontSize: 12 }}>
                Accepts: .7z .tar .tgz .tar.gz .gz
              </div>
              <input
                id="file-input"
                type="file"
                multiple
                accept={accepted.join(',')}
                style={{ display: 'none' }}
                onChange={(e) => {
                  const selected = Array.from(e.target.files ?? [])
                  if (selected.length > 0) setFiles(selected)
                }}
              />
            </div>

            {files.length > 0 && (
              <div style={{ marginBottom: 16, maxHeight: 120, overflowY: 'auto' }}>
                {files.map((selectedFile) => (
                  <div
                    key={`${selectedFile.name}-${selectedFile.size}-${selectedFile.lastModified}`}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: 10,
                      padding: '5px 0',
                      borderBottom: '1px solid #f1f5f9',
                      color: '#475569',
                      fontSize: 12,
                    }}
                  >
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {selectedFile.name}
                    </span>
                    <span style={{ color: '#94a3b8', flex: '0 0 auto' }}>
                      {formatBytes(selectedFile.size)}
                    </span>
                  </div>
                ))}
              </div>
            )}

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
              disabled={files.length === 0}
              style={{
                width: '100%',
                padding: '10px',
                background: files.length > 0 ? '#3b82f6' : '#e2e8f0',
                border: 'none',
                borderRadius: 6,
                color: files.length > 0 ? '#fff' : '#94a3b8',
                fontSize: 14,
                fontWeight: 600,
                cursor: files.length > 0 ? 'pointer' : 'not-allowed',
                transition: 'background 0.15s',
              }}
            >
              Upload{files.length > 1 ? ` ${files.length} Files` : ''}
            </button>
          </>
        ) : (
          <div>
            <div style={{ color: '#475569', fontSize: 13, marginBottom: 12 }}>
              {stageText}
            </div>
            {files.length > 1 && (
              <div style={{ color: '#94a3b8', fontSize: 12, marginBottom: 8 }}>
                File {Math.min(currentIndex + 1, files.length)} of {files.length}
              </div>
            )}
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

function overallProgress(index: number, total: number, filePercent: number): number {
  if (total <= 0) return 0
  return Math.round(((index + filePercent / 100) / total) * 100)
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${kb.toFixed(1)} KB`
  const mb = kb / 1024
  if (mb < 1024) return `${mb.toFixed(1)} MB`
  return `${(mb / 1024).toFixed(1)} GB`
}
