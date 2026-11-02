import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type PointerEvent, type ReactNode } from 'react'
import { WAVEFORM_CACHE_MIN_SECONDS, type ExportRequest, type FileRow } from '@shared/api'
import { AudioEngine, samplesOf, type ChannelMode, type TimeRange } from '../audio/engine'
import { computePeaks, decodePeaks, encodePeaks, envelope, type Peaks } from '../audio/peaks'
import { dragSound, type DragLabel } from '../drag'
import { formatDuration, formatLength } from '../format'
import { cssColor, isLight, useColorScheme } from '../theme'
import { DragIcon, LoopIcon, PauseIcon, PlayIcon } from '../icons'

const LONG_FILE_SECONDS = 20 * 60
const DRAG_THRESHOLD = 3
const MIN_SELECTION_SECONDS = 0.01
// Must match the main process's key.
function requestKey(request: ExportRequest): string {
  return [request.fileId, request.start, request.end, request.channel, request.fades].join('|')
}

const ALT_KEY = navigator.userAgent.includes('Mac') ? 'Option' : 'Alt'

const CHANNEL_OPTIONS: { mode: ChannelMode; label: string; title: string; key: string }[] = [
  { mode: 'both', label: 'Stereo', title: 'Both channels', key: '1' },
  { mode: 'left', label: 'L', title: 'Solo left channel', key: '2' },
  { mode: 'right', label: 'R', title: 'Solo right channel', key: '3' }
]

const MUTED_LANE_ALPHA = 0.28

function readWaveColors() {
  return {
    centerLine: cssColor('--wave-center'),
    rest: { stroke: cssColor('--wave-rest'), fill: cssColor('--wave-rest-fill') },
    played: { stroke: cssColor('--wave-played'), fill: cssColor('--wave-played-fill') },
    selected: { stroke: cssColor('--wave-selected'), fill: cssColor('--wave-selected-fill') },
    selectionShade: cssColor('--wave-shade'),
    playhead: cssColor('--wave-playhead'),
    laneDivider: cssColor('--wave-divider'),
    laneLabel: cssColor('--text-3')
  }
}

type WaveColors = ReturnType<typeof readWaveColors>
let waveColors: { light: boolean; colors: WaveColors } | null = null

function currentWaveColors(): WaveColors {
  if (waveColors?.light !== isLight()) waveColors = { light: isLight(), colors: readWaveColors() }
  return waveColors.colors
}

type LoadState =
  | { status: 'empty' }
  | { status: 'loading' }
  | { status: 'ready'; buffer: AudioBuffer }
  | { status: 'long' }
  | { status: 'error'; message: string }

interface PlayerProps {
  file: FileRow | null
  playRequest: number
}

export function Player({ file, playRequest }: PlayerProps) {
  const engine = useMemo(() => new AudioEngine(), [])
  const [load, setLoad] = useState<LoadState>({ status: 'empty' })
  const [peaks, setPeaks] = useState<Peaks | null>(null)
  const [selection, setSelection] = useState<TimeRange | null>(null)
  const [playing, setPlaying] = useState(false)
  const [loop, setLoop] = usePersistedFlag('player.loop', false)
  // New key: an old saved value does not carry over.
  const [autoplay, setAutoplay] = usePersistedFlag('player.autoplay.v2', true)
  const [forceLoadId, setForceLoadId] = useState<number | null>(null)
  const [channelMode, setChannelMode] = useState<ChannelMode>('both')
  // New key: an old saved value does not carry over.
  const [fades, setFades] = usePersistedFlag('export.fadeEdges', false)
  const [exportError, setExportError] = useState<string | null>(null)

  const buffer = load.status === 'ready' ? load.buffer : null
  const duration = buffer?.duration ?? file?.duration ?? 0
  const channels = Math.min(2, buffer?.numberOfChannels ?? peaks?.channels ?? file?.channels ?? 1)
  const stereo = channels === 2
  const soloChannel: 0 | 1 | null = stereo && channelMode !== 'both' ? (channelMode === 'left' ? 0 : 1) : null

  const live = useRef({ buffer, selection, loop, autoplay, duration, stereo })
  live.current = { buffer, selection, loop, autoplay, duration, stereo }

  const startPlayback = useCallback(
    (from: number, range: TimeRange | null) => {
      const { buffer, loop } = live.current
      if (!buffer) return
      const inRange = range !== null && from >= range.start && from < range.end
      const end = inRange ? range.end : buffer.duration
      const loopRange = loop ? (inRange ? range : { start: 0, end: buffer.duration }) : null
      engine.play(buffer, from, end, loopRange)
      setPlaying(true)
    },
    [engine]
  )

  useEffect(() => {
    engine.onEnded = () => setPlaying(false)
  }, [engine])

  const previousFileId = useRef<number | null>(null)
  const handledRequest = useRef(playRequest)
  useEffect(() => {
    const requested = playRequest !== handledRequest.current
    handledRequest.current = playRequest
    engine.stop()
    setPlaying(false)
    setSelection(null)
    if (!file) {
      previousFileId.current = null
      setLoad({ status: 'empty' })
      setPeaks(null)
      return
    }

    let cancelled = false
    const sameFile = previousFileId.current === file.id
    previousFileId.current = file.id
    const cacheable = (file.duration ?? 0) >= WAVEFORM_CACHE_MIN_SECONDS
    const cachedPeaks = cacheable
      ? window.soundpicker.readPeaks(file.id).then((bytes) => (bytes ? decodePeaks(bytes) : null))
      : Promise.resolve(null)
    if (!sameFile) {
      setPeaks(null)
      void cachedPeaks.then((cached) => {
        if (!cancelled && cached) setPeaks((current) => current ?? cached)
      })
    }

    if ((file.duration ?? 0) > LONG_FILE_SECONDS && forceLoadId !== file.id) {
      setLoad({ status: 'long' })
      return () => {
        cancelled = true
      }
    }

    setLoad((current) => (sameFile && current.status === 'ready' ? current : { status: 'loading' }))
    engine
      .load(file.id)
      .then(async (decoded) => {
        if (cancelled) return
        setLoad({ status: 'ready', buffer: decoded })
        live.current.buffer = decoded
        if ((live.current.autoplay && requested) || forceLoadId === file.id) startPlayback(0, null)
        if (!sameFile) {
          const computed = computePeaks(decoded)
          setPeaks(computed)
          if (cacheable && !(await cachedPeaks)) void window.soundpicker.writePeaks(file.id, encodePeaks(computed))
        }
      })
      .catch(() => {
        if (!cancelled) setLoad({ status: 'error', message: 'This file could not be played.' })
      })
    return () => {
      cancelled = true
    }
  }, [file?.id, playRequest, forceLoadId, engine, startPlayback])

  useEffect(() => () => engine.stop(), [engine])

  useEffect(() => setChannelMode('both'), [file?.id])
  useEffect(() => engine.setChannelMode(channelMode), [engine, channelMode])

  useEffect(() => {
    if (!exportError) return
    const timer = setTimeout(() => setExportError(null), 6000)
    return () => clearTimeout(timer)
  }, [exportError])

  const togglePlay = useCallback(() => {
    if (engine.playing) {
      engine.pause()
      setPlaying(false)
      return
    }
    const { selection, duration } = live.current
    let from = engine.position()
    if (selection && (from < selection.start || from >= selection.end - MIN_SELECTION_SECONDS)) from = selection.start
    if (from >= duration - MIN_SELECTION_SECONDS) from = selection?.start ?? 0
    startPlayback(from, selection)
  }, [engine, startPlayback])

  const clearSelection = useCallback(() => {
    if (!live.current.selection) return
    setSelection(null)
    live.current.selection = null
    if (engine.playing) startPlayback(engine.position(), null)
  }, [engine, startPlayback])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
      if (event.code === 'Space') {
        event.preventDefault()
        togglePlay()
      } else if (event.key === 'Escape') {
        clearSelection()
      } else if (live.current.stereo && !event.metaKey && !event.ctrlKey && !event.altKey) {
        const option = CHANNEL_OPTIONS.find((candidate) => candidate.key === event.key)
        if (option) setChannelMode(option.mode)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [togglePlay, clearSelection])

  const toggleLoop = () => {
    const next = !loop
    setLoop(next)
    live.current.loop = next
    if (engine.playing) startPlayback(engine.position(), selection)
  }

  const onSelect = (range: TimeRange) => {
    setSelection(range)
    startPlayback(range.start, range)
  }
  const onClickAt = (time: number, shift: boolean) => {
    if (shift) {
      const anchor = selection ? (time < selection.start ? selection.end : selection.start) : engine.position()
      const range = { start: Math.min(anchor, time), end: Math.max(anchor, time) }
      if (range.end - range.start >= MIN_SELECTION_SECONDS) return onSelect(range)
    }
    setSelection(null)
    startPlayback(time, null)
  }

  const exportRequest = useCallback(
    (range: TimeRange | null): Omit<ExportRequest, 'fileId'> => ({
      start: range?.start ?? null,
      end: range?.end ?? null,
      channel: soloChannel,
      fades
    }),
    [soloChannel, fades]
  )

  const preparedKey = useRef<string | null>(null)
  const samplesFor = useCallback(
    async (target: FileRow, range: TimeRange | null) => {
      const native = await engine.loadNative(target.id, target.sampleRate ?? live.current.buffer?.sampleRate ?? 44100)
      return samplesOf(native, range, soloChannel)
    },
    [engine, soloChannel]
  )
  useEffect(() => {
    if (!file || file.ext !== 'mp3' || load.status !== 'ready' || (!selection && soloChannel === null)) return
    const request = { ...exportRequest(selection), fileId: file.id }
    const key = requestKey(request)
    if (preparedKey.current === key) return
    const timer = setTimeout(() => {
      void samplesFor(file, selection).then((pcm) => {
        window.soundpicker.prepareExport({ ...request, pcm })
        preparedKey.current = key
      })
    }, 150)
    return () => clearTimeout(timer)
  }, [file, load.status, selection, soloChannel, exportRequest, samplesFor])

  const dragOut = async (whole: boolean) => {
    if (!file) return
    const range = whole ? null : live.current.selection
    const request = exportRequest(range)
    const encode = file.ext === 'mp3' && (range !== null || soloChannel !== null)
    const prepared = encode && preparedKey.current === requestKey({ ...request, fileId: file.id })
    const label: DragLabel = {
      badge: soloChannel === 0 ? 'L' : soloChannel === 1 ? 'R' : stereo ? 'Stereo' : 'Mono',
      title: formatLength(range ? range.end - range.start : duration || null)
    }
    let message = await dragSound(file, encode && !prepared ? { ...request, pcm: await samplesFor(file, range) } : request, label)
    if (message && prepared) message = await dragSound(file, { ...request, pcm: await samplesFor(file, range) }, label)
    if (message) setExportError(message)
  }

  const status = load.status

  return (
    <section className="player" aria-label="Player">
      <div className="player-head">
        {file && <span className="player-title">{file.name}</span>}
        {file && <span className="player-path mono">{file.relDir || '/'}</span>}
        <div className="player-head-end">
          {stereo && (
            <div className="channel-switch" role="group" aria-label="Channels">
              {CHANNEL_OPTIONS.map((option) => (
                <button
                  key={option.mode}
                  aria-pressed={channelMode === option.mode}
                  title={`${option.title} (${option.key})`}
                  onClick={() => setChannelMode(option.mode)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          )}
          <label className="switch">
            <input type="checkbox" checked={autoplay} onChange={(event) => setAutoplay(event.target.checked)} />
            <span className="switch-track" aria-hidden="true" />
            Auto-play on click
          </label>
        </div>
      </div>

      <Waveform
        peaks={peaks}
        duration={duration}
        selection={selection}
        playing={playing}
        engine={engine}
        interactive={status === 'ready'}
        soloChannel={soloChannel}
        onSelect={onSelect}
        onClickAt={onClickAt}
        onDragOut={(whole) => void dragOut(whole)}
      >
        {status === 'loading' && !peaks && <span className="wave-message">Loading…</span>}
        {status === 'error' && <span className="wave-message is-error">{load.message}</span>}
        {status === 'long' && file && (
          <span className="wave-message">
            Long file ({formatLength(file.duration)}). Loading it takes a moment and a lot of memory.
            <button className="link-button" onClick={() => setForceLoadId(file.id)}>
              Load and play
            </button>
          </span>
        )}
        {status === 'empty' && <span className="wave-message">Select a file</span>}
      </Waveform>

      <Ruler duration={duration} />

      <div className="player-controls">
        <button
          className="play-button"
          aria-label={playing ? 'Pause' : 'Play'}
          title={playing ? 'Pause (Space)' : 'Play (Space)'}
          disabled={status !== 'ready'}
          onClick={togglePlay}
        >
          {playing ? <PauseIcon /> : <PlayIcon />}
        </button>
        <button
          className={`loop-button${loop ? ' is-on' : ''}`}
          aria-label="Loop"
          aria-pressed={loop}
          title={selection ? 'Loop the selection' : 'Loop the file'}
          onClick={toggleLoop}
        >
          <LoopIcon />
        </button>
        <div className="player-times">
          <span className="mono">
            <PositionLabel key={file?.id ?? 0} engine={engine} playing={playing} />
            <span className="muted-time"> / {formatDuration(duration || null)}</span>
          </span>
          <span className="player-selection">
            {selection
              ? `Selection ${formatDuration(selection.start)} – ${formatDuration(selection.end)} · ${(selection.end - selection.start).toFixed(2)} s`
              : 'No selection'}
            {soloChannel !== null && (
              <span className="solo-tag">Solo {soloChannel === 0 ? 'left' : 'right'} · export will be mono</span>
            )}
          </span>
        </div>
        <span className="player-spacer" />
        {exportError && <span className="player-hint is-error">{exportError}</span>}
        <label className="switch" title="5 ms fade-in and fade-out on exported fragments, so the cut does not click">
          <input type="checkbox" checked={fades} onChange={(event) => setFades(event.target.checked)} />
          <span className="switch-track" aria-hidden="true" />
          5 ms fades
        </label>
        <div
          className={`whole-file${file ? '' : ' is-disabled'}`}
          draggable={file !== null}
          title={`Drag the whole file out (or ${ALT_KEY}+drag the waveform)`}
          onDragStart={(event) => {
            event.preventDefault()
            void dragOut(true)
          }}
        >
          <DragIcon />
          Whole file
        </div>
      </div>
    </section>
  )
}

interface WaveformProps {
  peaks: Peaks | null
  duration: number
  selection: TimeRange | null
  playing: boolean
  engine: AudioEngine
  interactive: boolean
  soloChannel: number | null
  onSelect(range: TimeRange): void
  onClickAt(time: number, shift: boolean): void
  onDragOut(whole: boolean): void
  children?: ReactNode
}

function Waveform({
  peaks,
  duration,
  selection,
  playing,
  engine,
  interactive,
  soloChannel,
  onSelect,
  onClickAt,
  onDragOut,
  children
}: WaveformProps) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [width, setWidth] = useState(0)
  const [draft, setDraft] = useState<TimeRange | null>(null)
  const drag = useRef<{ x: number; time: number; shift: boolean; moved: boolean } | null>(null)
  const press = useRef<{ time: number; shift: boolean } | null>(null)
  const [altHeld, setAltHeld] = useState(false)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => setAltHeld(event.altKey)
    const onBlur = () => setAltHeld(false)
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKey)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKey)
      window.removeEventListener('blur', onBlur)
    }
  }, [])

  useEffect(() => {
    const element = canvas.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const outlines = useMemo(() => {
    if (!peaks || width <= 0) return null
    const points = Math.max(2, Math.floor(width / 2))
    return peaks.channels >= 2 ? [envelope(peaks, points, 0), envelope(peaks, points, 1)] : [envelope(peaks, points)]
  }, [peaks, width])
  const shown = draft ?? selection
  const scheme = useColorScheme()
  const lanes = outlines?.length ?? 1
  const activeLane = lanes === 2 ? soloChannel : null

  useEffect(() => {
    const draw = () => drawWaveform(canvas.current, outlines, duration, shown, peaks ? engine.position() : 0, activeLane)
    draw()
    if (!playing) return
    let frame = requestAnimationFrame(function tick() {
      draw()
      frame = requestAnimationFrame(tick)
    })
    return () => cancelAnimationFrame(frame)
  }, [outlines, duration, shown, playing, engine, peaks, activeLane, scheme])

  const timeAt = (event: PointerEvent) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const fraction = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width))
    return fraction * duration
  }

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!interactive || event.button !== 0) return
    if (event.altKey || (event.target as HTMLElement).dataset.drag) {
      press.current = { time: timeAt(event), shift: event.shiftKey }
      return
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { x: event.clientX, time: timeAt(event), shift: event.shiftKey, moved: false }
  }

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current
    if (!current) return
    if (!current.moved && Math.abs(event.clientX - current.x) < DRAG_THRESHOLD) return
    current.moved = true
    const time = timeAt(event)
    setDraft({ start: Math.min(current.time, time), end: Math.max(current.time, time) })
  }

  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const pressed = press.current
    press.current = null
    if (pressed) return onClickAt(pressed.time, pressed.shift)
    const current = drag.current
    drag.current = null
    setDraft(null)
    if (!current) return
    const time = timeAt(event)
    const range = { start: Math.min(current.time, time), end: Math.max(current.time, time) }
    if (current.moved && range.end - range.start >= MIN_SELECTION_SECONDS) onSelect(range)
    else onClickAt(current.time, current.shift)
  }

  const onDragStart = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    press.current = null
    onDragOut(event.altKey || !(event.target as HTMLElement).dataset.drag)
  }

  const dragArea =
    selection && interactive && !draft && duration > 0
      ? {
          left: `${(selection.start / duration) * 100}%`,
          width: `${((selection.end - selection.start) / duration) * 100}%`,
          top: activeLane === 1 ? '50%' : 0,
          height: activeLane === null ? '100%' : '50%'
        }
      : null

  return (
    <div
      className={`wave${interactive ? ' is-interactive' : ''}${interactive && altHeld ? ' is-whole-drag' : ''}`}
      draggable={interactive && altHeld}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => {
        drag.current = null
        press.current = null
        setDraft(null)
      }}
      onDragStart={onDragStart}
    >
      <canvas ref={canvas} className="wave-canvas" aria-label="Waveform" role="img" />
      {dragArea && <div className="wave-drag" data-drag="selection" draggable title="Drag the selection out" style={dragArea} />}
      {children}
    </div>
  )
}

function drawWaveform(
  element: HTMLCanvasElement | null,
  outlines: Float32Array[] | null,
  duration: number,
  selection: TimeRange | null,
  position: number,
  activeLane: number | null
) {
  if (!element) return
  const ratio = window.devicePixelRatio || 1
  const width = element.clientWidth
  const height = element.clientHeight
  if (element.width !== Math.round(width * ratio) || element.height !== Math.round(height * ratio)) {
    element.width = Math.round(width * ratio)
    element.height = Math.round(height * ratio)
  }
  const ctx = element.getContext('2d')
  if (!ctx) return
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
  ctx.clearRect(0, 0, width, height)

  const colors = currentWaveColors()
  const lanes = outlines?.length ?? 1
  const laneHeight = height / lanes
  for (let lane = 0; lane < lanes; lane++) {
    const top = lane * laneHeight
    if (lane > 0) {
      ctx.fillStyle = colors.laneDivider
      ctx.fillRect(0, Math.round(top), width, 1)
    }
    ctx.save()
    ctx.translate(0, top)
    ctx.globalAlpha = activeLane !== null && activeLane !== lane ? MUTED_LANE_ALPHA : 1
    drawLane(ctx, colors, outlines?.[lane] ?? null, width, laneHeight, duration, activeLane === null || activeLane === lane ? selection : null, position)
    ctx.restore()
    if (lanes > 1) {
      ctx.font = `10px ${getComputedStyle(element).getPropertyValue('--font-mono') || 'monospace'}`
      ctx.fillStyle = activeLane === lane ? colors.selected.stroke : colors.laneLabel
      ctx.fillText(lane === 0 ? 'L' : 'R', 6, top + 13)
    }
  }
}

function drawLane(
  ctx: CanvasRenderingContext2D,
  colors: WaveColors,
  outline: Float32Array | null,
  width: number,
  height: number,
  duration: number,
  selection: TimeRange | null,
  position: number
) {
  const mid = height / 2
  ctx.fillStyle = colors.centerLine
  ctx.fillRect(0, Math.round(mid), width, 1)
  if (!outline || duration <= 0) return

  const xOf = (time: number) => (time / duration) * width
  const shape = curvePath(outline, width, mid)

  const paint = (style: { stroke: string; fill: string }, from: number, to: number) => {
    if (to <= from) return
    ctx.save()
    ctx.beginPath()
    ctx.rect(from, 0, to - from, height)
    ctx.clip()
    ctx.fillStyle = style.fill
    ctx.fill(shape.area)
    ctx.strokeStyle = style.stroke
    ctx.lineWidth = 1.5
    ctx.lineJoin = 'round'
    ctx.stroke(shape.edges)
    ctx.restore()
  }

  const playedTo = position > 0 ? xOf(position) : 0
  paint(colors.rest, 0, width)
  paint(colors.played, 0, playedTo)
  if (selection) {
    const a = xOf(selection.start)
    const b = xOf(selection.end)
    ctx.fillStyle = colors.selectionShade
    ctx.fillRect(a, 0, b - a, height)
    paint(colors.selected, a, b)
  }
  if (position > 0) {
    ctx.fillStyle = colors.playhead
    ctx.fillRect(Math.round(playedTo), 0, 1, height)
  }
}

function curvePath(outline: Float32Array, width: number, mid: number) {
  const count = outline.length
  const xs = (i: number) => (i / (count - 1)) * width
  const top = (i: number) => mid - outline[i] * mid * 0.92
  const bottom = (i: number) => mid + outline[i] * mid * 0.92

  const trace = (path: Path2D, y: (i: number) => number, reverse: boolean, move: boolean) => {
    const at = (k: number) => (reverse ? count - 1 - k : k)
    if (move) path.moveTo(xs(at(0)), y(at(0)))
    else path.lineTo(xs(at(0)), y(at(0)))
    for (let k = 1; k < count - 1; k++) {
      const i = at(k)
      const j = at(k + 1)
      path.quadraticCurveTo(xs(i), y(i), (xs(i) + xs(j)) / 2, (y(i) + y(j)) / 2)
    }
    path.lineTo(xs(at(count - 1)), y(at(count - 1)))
  }

  const area = new Path2D()
  trace(area, top, false, true)
  trace(area, bottom, true, false)
  area.closePath()

  const edges = new Path2D()
  trace(edges, top, false, true)
  trace(edges, bottom, false, true)
  return { area, edges }
}

function Ruler({ duration }: { duration: number }) {
  const ticks = [0, 0.2, 0.4, 0.6, 0.8, 1]
  return (
    <div className="ruler mono" aria-hidden="true">
      {ticks.map((tick) => (
        <span key={tick}>{duration > 0 ? formatDuration(duration * tick) : ''}</span>
      ))}
    </div>
  )
}

function PositionLabel({ engine, playing }: { engine: AudioEngine; playing: boolean }) {
  const label = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    const update = () => {
      if (label.current) label.current.textContent = formatDuration(engine.position())
    }
    update()
    if (!playing) return
    let frame = requestAnimationFrame(function tick() {
      update()
      frame = requestAnimationFrame(tick)
    })
    return () => cancelAnimationFrame(frame)
  }, [engine, playing])
  return <span ref={label}>0:00.00</span>
}

function usePersistedFlag(key: string, initial: boolean): [boolean, (value: boolean) => void] {
  const [value, setValue] = useState(() => {
    try {
      const stored = localStorage.getItem(key)
      return stored === null ? initial : stored === 'true'
    } catch {
      return initial
    }
  })
  const update = useCallback(
    (next: boolean) => {
      setValue(next)
      try {
        localStorage.setItem(key, String(next))
      } catch {
      }
    },
    [key]
  )
  return [value, update]
}
