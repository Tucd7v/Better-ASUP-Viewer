import { useCallback, useRef, useState } from 'react'

export function useResizable(defaultWidth = 320, defaultHeight = 380) {
  const [width, setWidth] = useState(defaultWidth)
  const [height, setHeight] = useState(defaultHeight)
  const dragging = useRef<'x' | 'y' | null>(null)

  const onResizeX = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragging.current = 'x'
    const onMove = (ev: MouseEvent) => {
      setWidth((w) => Math.max(220, w + ev.movementX))
    }
    const onUp = () => {
      dragging.current = null
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [])

  const onResizeY = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragging.current = 'y'
    const onMove = (ev: MouseEvent) => {
      setHeight((h) => Math.max(120, Math.min(1200, h + ev.movementY)))
    }
    const onUp = () => {
      dragging.current = null
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [])

  return { width, height, setWidth, onResizeX, onResizeY }
}
