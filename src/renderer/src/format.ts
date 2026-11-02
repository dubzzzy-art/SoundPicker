export function formatCount(n: number): string {
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
}

// 1234 → 1K+, 15000 → 15K: the tree's count column keeps one width.
export function formatCompactCount(n: number): string {
  const [unit, suffix] = n >= 1_000_000 ? [1_000_000, 'M'] : n >= 1000 ? [1000, 'K'] : [1, '']
  if (unit === 1) return String(n)
  return `${Math.floor(n / unit)}${suffix}${n % unit === 0 ? '' : '+'}`
}

export function formatDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return '—'
  const hundredths = Math.round(seconds * 100)
  const totalSeconds = Math.floor(hundredths / 100)
  const h = Math.floor(totalSeconds / 3600)
  const m = Math.floor((totalSeconds % 3600) / 60)
  const s = totalSeconds % 60
  if (h > 0) return `${h}:${pad(m)}:${pad(s)}`
  return `${m}:${pad(s)}.${pad(hundredths % 100)}`
}

export function formatLength(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return '—'
  const hundredths = Math.round(seconds * 100)
  if (hundredths < 100) return `${(hundredths / 100).toFixed(2)}s`
  const total = Math.round(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) return `${h}h ${m}m ${s}s`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

export function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

export function formatRate(sampleRate: number | null): string {
  if (!sampleRate) return '—'
  const k = sampleRate / 1000
  return `${Number.isInteger(k) ? k : k.toFixed(1)}k`
}

export function formatChannels(channels: number | null): string {
  if (!channels) return '—'
  if (channels === 1) return 'Mono'
  if (channels === 2) return 'Stereo'
  return `${channels} ch`
}

export function formatBitrate(bitrate: number | null): string {
  return bitrate ? `${Math.round(bitrate / 1000)} kbps` : '—'
}

export function formatWhen(timestamp: number, now = new Date()): string {
  const date = new Date(timestamp)
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  if (timestamp >= dayStart) return `today ${time}`
  if (timestamp >= dayStart - 86_400_000) return `yesterday ${time}`
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${time}`
}

function pad(n: number): string {
  return n.toString().padStart(2, '0')
}
