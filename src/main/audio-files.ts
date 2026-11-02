import { net, protocol } from 'electron'
import { pathToFileURL } from 'node:url'
import { AUDIO_SCHEME } from '../shared/api'

// Only indexed files are served; the window never sends a path.
export function registerAudioScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: AUDIO_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true }
    }
  ])
}

export function handleAudioRequests(resolvePath: (fileId: number) => string | null): void {
  protocol.handle(AUDIO_SCHEME, async (request) => {
    const url = new URL(request.url)
    const fileId = Number(url.pathname.slice(1))
    if (url.hostname !== 'file' || !Number.isInteger(fileId)) return new Response('Bad request', { status: 400 })
    const path = resolvePath(fileId)
    if (!path) return new Response('Not in the index', { status: 404 })
    try {
      const file = await net.fetch(pathToFileURL(path).toString())
      // The window is a file:// page: every request is cross-origin.
      const headers = new Headers(file.headers)
      headers.set('Access-Control-Allow-Origin', '*')
      return new Response(file.body, { status: file.status, headers })
    } catch {
      return new Response('File could not be read', { status: 404 })
    }
  })
}
