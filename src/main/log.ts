import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

let logFile: string | null = null

export function initLog(logDir: string): string {
  mkdirSync(logDir, { recursive: true })
  logFile = join(logDir, 'main.log')
  return logFile
}

export function log(level: 'info' | 'warn' | 'error', message: string, detail?: unknown): void {
  const suffix = detail === undefined ? '' : ` ${formatDetail(detail)}`
  const line = `${new Date().toISOString()} ${level.toUpperCase()} ${message}${suffix}\n`
  if (level === 'error') console.error(line.trimEnd())
  else console.log(line.trimEnd())
  if (!logFile) return
  try {
    appendFileSync(logFile, line)
  } catch {
  }
}

function formatDetail(detail: unknown): string {
  if (detail instanceof Error) return detail.stack ?? detail.message
  if (typeof detail === 'string') return detail
  try {
    return JSON.stringify(detail)
  } catch {
    return String(detail)
  }
}
