import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
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
  const expandedContainerRef = useRef<HTMLDivElement>(null)
  const [containerWidth, setContainerWidth] = useState(0)
  const [expandedWidth, setExpandedWidth] = useState(0)
  const [expanded, setExpanded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expandedError, setExpandedError] = useState<string | null>(null)
  const renderedRef = useRef<string>('')
  const expandedRenderedRef = useRef<string>('')
  const lastRenderedWidth = useRef(0)
  const widthTimer = useRef<number | null>(null)
  const reactId = useId()
  const uid = useMemo(() => `mermaid-${reactId.replace(/[^a-zA-Z0-9_-]/g, '')}`, [reactId])
  const renderKey = useMemo(() => `${chart}:${Math.round(containerWidth)}`, [chart, containerWidth])
  const renderId = useMemo(() => `${uid}-${hashString(renderKey)}`, [uid, renderKey])
  const expandedRenderKey = useMemo(() => `${chart}:expanded:${Math.round(expandedWidth)}`, [chart, expandedWidth])
  const expandedRenderId = useMemo(() => `${uid}-expanded-${hashString(expandedRenderKey)}`, [uid, expandedRenderKey])

  const closeExpanded = useCallback(() => {
    setExpanded(false)
    setExpandedWidth(0)
    expandedRenderedRef.current = ''
  }, [])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const updateWidth = (width: number, debounce: boolean) => {
      const nextWidth = Math.round(width)
      if (!nextWidth) return
      if (lastRenderedWidth.current && Math.abs(nextWidth - lastRenderedWidth.current) < 10) return
      lastRenderedWidth.current = nextWidth
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
    const hiddenDiv = document.createElement('div')

    mermaid.render(renderId, chart)
      .then(({ svg }) => {
        hiddenDiv.innerHTML = svg
        if (containerRef.current && renderKey === renderedRef.current) {
          containerRef.current.innerHTML = hiddenDiv.innerHTML
        }
      })
      .catch((err: Error) => {
        if (renderKey === renderedRef.current) setError(err.message)
      })
  }, [chart, containerWidth, renderId, renderKey])

  useEffect(() => {
    if (!expanded) return undefined

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeExpanded()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [closeExpanded, expanded])

  useEffect(() => {
    if (!expanded) return undefined
    const el = expandedContainerRef.current
    if (!el) return undefined

    const updateWidth = (width: number) => {
      const nextWidth = Math.round(width)
      if (nextWidth) setExpandedWidth(nextWidth)
    }

    updateWidth(el.getBoundingClientRect().width)

    const observer = new ResizeObserver((entries) => {
      updateWidth(entries[0]?.contentRect.width ?? 0)
    })

    observer.observe(el)
    return () => {
      observer.disconnect()
    }
  }, [expanded])

  useEffect(() => {
    if (!expanded || !expandedContainerRef.current || !expandedWidth || expandedRenderKey === expandedRenderedRef.current) return
    expandedRenderedRef.current = expandedRenderKey
    setExpandedError(null)
    const hiddenDiv = document.createElement('div')

    mermaid.render(expandedRenderId, chart)
      .then(({ svg }) => {
        hiddenDiv.innerHTML = svg
        if (expandedContainerRef.current && expandedRenderKey === expandedRenderedRef.current) {
          expandedContainerRef.current.innerHTML = hiddenDiv.innerHTML
        }
      })
      .catch((err: Error) => {
        if (expandedRenderKey === expandedRenderedRef.current) setExpandedError(err.message)
      })
  }, [chart, expanded, expandedRenderId, expandedRenderKey, expandedWidth])

  if (error) {
    return (
      <div style={{ padding: 12, background: '#fef2f2', borderRadius: 8, border: '1px solid #fecaca', fontSize: 12, color: '#dc2626' }}>
        ⚠️ Mermaid 渲染失败: {error}
        <pre style={{ marginTop: 8, fontSize: 10, color: '#64748b', whiteSpace: 'pre-wrap' }}>{chart}</pre>
      </div>
    )
  }

  return (
    <>
      <div style={{ position: 'relative', width: '100%' }}>
        <div
          ref={containerRef}
          style={{ background: '#f8fafc', border: '2px solid #e2e8f0', borderRadius: 8, padding: 16, overflow: 'auto' }}
        />
        <button
          type="button"
          aria-label="Expand Mermaid diagram"
          title="Expand"
          onClick={() => setExpanded(true)}
          style={{
            position: 'absolute',
            top: 8,
            right: 8,
            width: 28,
            height: 28,
            border: '1px solid #cbd5e1',
            borderRadius: 6,
            background: 'rgba(255, 255, 255, 0.92)',
            color: '#334155',
            cursor: 'pointer',
            fontSize: 15,
            lineHeight: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 1px 3px rgba(15, 23, 42, 0.12)',
          }}
        >
          ⛶
        </button>
      </div>

      {expanded && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Expanded Mermaid diagram"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeExpanded()
          }}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 10000,
            background: 'rgba(15, 23, 42, 0.58)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
          }}
        >
          <div
            style={{
              width: '90vw',
              height: '90vh',
              background: '#fff',
              borderRadius: 8,
              boxShadow: '0 24px 80px rgba(15, 23, 42, 0.35)',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                height: 42,
                flex: '0 0 auto',
                borderBottom: '1px solid #e2e8f0',
                display: 'flex',
                justifyContent: 'flex-end',
                alignItems: 'center',
                padding: '0 10px',
              }}
            >
              <button
                type="button"
                aria-label="Close expanded Mermaid diagram"
                onClick={closeExpanded}
                style={{
                  width: 30,
                  height: 30,
                  border: '1px solid #cbd5e1',
                  borderRadius: 6,
                  background: '#fff',
                  color: '#334155',
                  cursor: 'pointer',
                  fontSize: 20,
                  lineHeight: 1,
                }}
              >
                ×
              </button>
            </div>
            <div
              style={{
                flex: 1,
                overflow: 'auto',
                display: 'flex',
                flexDirection: 'column',
                gap: 12,
                justifyContent: 'flex-start',
                alignItems: 'flex-start',
                padding: 16,
                background: '#f8fafc',
              }}
            >
              {expandedError && (
                <div style={{ width: '100%', padding: 12, background: '#fef2f2', borderRadius: 8, border: '1px solid #fecaca', fontSize: 12, color: '#dc2626' }}>
                  ⚠️ Mermaid 渲染失败: {expandedError}
                </div>
              )}
              <div
                ref={expandedContainerRef}
                style={{
                  width: '100%',
                  minHeight: 300,
                  border: '1px solid #e2e8f0',
                  borderRadius: 8,
                  padding: 16,
                  overflow: 'auto',
                  background: '#fff',
                }}
              />
            </div>
          </div>
        </div>
      )}
    </>
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
