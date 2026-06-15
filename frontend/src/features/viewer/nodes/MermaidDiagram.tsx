import { memo, useEffect, useId, useRef, useState } from 'react'
import mermaid from 'mermaid'

mermaid.initialize({
  startOnLoad: false,
  theme: 'base',
  themeVariables: {
    primaryColor: '#eff6ff',
    primaryBorderColor: '#3b82f6',
    primaryTextColor: '#1e293b',
    lineColor: '#94a3b8',
    fontSize: '13px',
    fontFamily: 'system-ui, -apple-system, sans-serif',
  },
})

interface MermaidDiagramProps {
  chart: string
}

function MermaidDiagramComponent({ chart }: MermaidDiagramProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string | null>(null)
  const uid = useId()

  useEffect(() => {
    if (!containerRef.current) return
    const id = `mermaid-${uid.replace(/:/g, '')}`
    containerRef.current.innerHTML = ''

    mermaid.render(id, chart)
      .then(({ svg }) => {
        if (containerRef.current) containerRef.current.innerHTML = svg
      })
      .catch((err: Error) => {
        setError(err.message)
      })
  }, [chart, uid])

  if (error) {
    return (
      <div style={{ padding: 12, background: '#fef2f2', borderRadius: 8, border: '1px solid #fecaca', fontSize: 12, color: '#dc2626' }}>
        ⚠️ Mermaid 渲染失败: {error}
        <pre style={{ marginTop: 8, fontSize: 10, color: '#64748b', whiteSpace: 'pre-wrap' }}>{chart}</pre>
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      style={{ background: '#f8fafc', border: '2px solid #e2e8f0', borderRadius: 8, padding: 16, overflow: 'auto' }}
    />
  )
}

const MermaidDiagram = memo(MermaidDiagramComponent)
export default MermaidDiagram
