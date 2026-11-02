import type { ExportRequest, FileRow } from '@shared/api'
import { cssColor } from './theme'

export interface DragLabel {
  badge: string
  title: string
}

let outgoing = false
window.addEventListener('mousemove', (event) => {
  if (event.buttons === 0) outgoing = false
})

export function isOutgoingDrag(): boolean {
  return outgoing
}

export async function dragSound(file: FileRow, request: Omit<ExportRequest, 'fileId'>, label: DragLabel): Promise<string | null> {
  outgoing = true
  const [result, icon] = await Promise.all([window.soundpicker.exportAudio({ ...request, fileId: file.id }), dragIcon(label)])
  if (!result.ok) return result.message
  window.soundpicker.dragExported([result.path], icon)
  return null
}

export async function dragFiles(fileIds: number[], label: DragLabel): Promise<void> {
  outgoing = true
  window.soundpicker.dragFiles(fileIds, await dragIcon(label))
}

const SCALE = 2
// Windows fades a wide drag image out towards its sides.
const MAX_WIDTH = navigator.userAgent.includes('Windows') ? 156 : 200
const HEIGHT = 32

export async function dragIcon(label: DragLabel): Promise<Uint8Array> {
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  if (!ctx) return new Uint8Array()
  const font = `600 12px ${getComputedStyle(document.body).fontFamily}`
  const badgeFont = `600 10px ${getComputedStyle(document.documentElement).getPropertyValue('--font-mono') || 'monospace'}`
  ctx.font = badgeFont
  const badgeWidth = Math.ceil(ctx.measureText(label.badge).width) + 12
  ctx.font = font
  const titleStart = 6 + badgeWidth + 8
  const width = Math.min(MAX_WIDTH, titleStart + Math.ceil(ctx.measureText(label.title).width) + 10)

  canvas.width = width * SCALE
  canvas.height = HEIGHT * SCALE
  ctx.scale(SCALE, SCALE)
  ctx.fillStyle = cssColor('--card')
  ctx.strokeStyle = cssColor('--accent-fill')
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.roundRect(0.5, 0.5, width - 1, HEIGHT - 1, 8)
  ctx.fill()
  ctx.stroke()

  ctx.fillStyle = cssColor('--accent-hover')
  ctx.beginPath()
  ctx.roundRect(6, 6, badgeWidth, HEIGHT - 12, 5)
  ctx.fill()
  ctx.fillStyle = cssColor('--accent')
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = badgeFont
  ctx.fillText(label.badge, 6 + badgeWidth / 2, HEIGHT / 2 + 0.5)

  ctx.textAlign = 'left'
  ctx.fillStyle = cssColor('--text')
  ctx.font = font
  ctx.fillText(fit(ctx, label.title, width - titleStart - 10), titleStart, HEIGHT / 2 + 0.5)

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  return blob ? new Uint8Array(await blob.arrayBuffer()) : new Uint8Array()
}

function fit(ctx: CanvasRenderingContext2D, text: string, width: number): string {
  if (ctx.measureText(text).width <= width) return text
  let end = text.length
  while (end > 1 && ctx.measureText(`${text.slice(0, end)}…`).width > width) end--
  return `${text.slice(0, end)}…`
}
