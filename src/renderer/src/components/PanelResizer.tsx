import { useRef, useState, type PointerEvent } from 'react'

export interface PanelWidth {
  key: string
  initial: number
  min: number
  max: number
}

export function usePanelWidth({ key, initial, min, max }: PanelWidth): [number, (width: number, done?: boolean) => void] {
  const [width, setWidth] = useState(() => {
    try {
      const stored = Number(localStorage.getItem(key))
      return stored >= min && stored <= max ? stored : initial
    } catch {
      return initial
    }
  })
  const update = (next: number, done = false) => {
    const clamped = Math.round(Math.min(max, Math.max(min, next)))
    setWidth(clamped)
    if (!done) return
    try {
      localStorage.setItem(key, String(clamped))
    } catch {
    }
  }
  return [width, update]
}

interface PanelResizerProps {
  edge: 'left' | 'right'
  label: string
  width: number
  limits: PanelWidth
  onResize(width: number, done?: boolean): void
}

export function PanelResizer({ edge, label, width, limits, onResize }: PanelResizerProps) {
  const start = useRef<{ x: number; width: number } | null>(null)
  const widthAt = (x: number) => start.current!.width + (x - start.current!.x) * (edge === 'right' ? 1 : -1)
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    start.current = { x: event.clientX, width }
  }
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (start.current) onResize(widthAt(event.clientX))
  }
  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (!start.current) return
    onResize(widthAt(event.clientX), true)
    start.current = null
  }
  return (
    <div
      className={`panel-resizer is-${edge}`}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={width}
      aria-valuemin={limits.min}
      aria-valuemax={limits.max}
      title="Drag to resize · double-click to reset"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={() => onResize(limits.initial, true)}
    />
  )
}
