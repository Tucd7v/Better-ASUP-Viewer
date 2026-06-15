import { memo, useEffect, useId, useMemo, useRef, useState } from 'react'
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
  const [containerWidth, setContainerWidth] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const renderedRef = useRef<string>('')
  const widthTimer = useRef<number | null>(null)
  const reactId = useId()
  const uid = useMemo(() => `mermaid-${reactId.replace(/[^a-zA-Z0-9_-]/g, '')}`, [reactId])
  const renderKey = useMemo(() => `${chart}:${Math.round(containerWidth)}`, [chart, containerWidth])
  const renderId = useMemo(() => `${uid}-${hashString(renderKey)}`, [uid, renderKey])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const updateWidth = (width: number, debounce: boolean) => {
      const nextWidth = Math.round(width)
      if (!nextWidth) return
      if (widthTimer.current) window.clearTimeout(widthTimer.current)

      if (debounce) {
        widthTimer.current = window.setTimeout(() => {
          setContainerWidth(nextWidth)
          widthTimer.current = null
        }, 200)
        return
      }

      setContainerWidth(nextWidth)
    }

    updateWidth(el.getBoundingClientRect().width, false)

    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0
      updateWidth(width, true)
    })

    observer.observe(el)
    return () => {
      observer.disconnect()
      if (widthTimer.current) window.clearTimeout(widthTimer.current)
    }
  }, [])

  useEffect(() => {
    if (!containerRef.current || !containerWidth || renderKey === renderedRef.current) return
    renderedRef.current = renderKey
    setError(null)
    containerRef.current.innerHTML = ''

    mermaid.render(renderId, chart)
      .then(({ svg }) => {
        if (containerRef.current && renderKey === renderedRef.current) {
          containerRef.current.innerHTML = svg
        }
      })
      .catch((err: Error) => {
        if (renderKey === renderedRef.current) setError(err.message)
      })
  }, [chart, containerWidth, renderId, renderKey])

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

function hashString(value: string) {
  let hash = 0
  for (let i = 0; i < value.length; i += 1) {
    hash = Math.imul(31, hash) + value.charCodeAt(i) | 0
  }
  return Math.abs(hash).toString(36)
}

const MermaidDiagram = memo(MermaidDiagramComponent)
export default MermaidDiagram
