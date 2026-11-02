import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SearchRequest } from '../src/shared/api'
import type { LibraryStore } from '../src/main/library-store'
import { SearchService } from '../src/main/search/search-service'

const WORKER = join(__dirname, 'fixtures', 'fake-search-worker.mjs')
const store = { filesByIds: () => [] } as unknown as LibraryStore

function request(query: string): SearchRequest {
  return { query, scope: 'all', libraryId: null, exact: false, sort: { key: 'relevance', direction: 1 }, favoritesOnly: false }
}

let service: SearchService | null = null
afterEach(() => {
  service?.stop()
  delete process.env.FAKE_SEARCH_FAIL_FIRST_BUILD
})

function start(): { service: SearchService; announced: () => number } {
  let announced = 0
  service = new SearchService(WORKER, ':memory:', store, () => announced++)
  return { service, announced: () => announced }
}

describe('search service', () => {
  it('answers a search', async () => {
    const { service } = start()
    expect(await service.search(request('wood'))).toMatchObject({ error: null, total: 0 })
  })

  it('reports a dead thread as an error, and restarts it quietly for the next search', async () => {
    const { service, announced } = start()
    await service.search(request('wood'))
    expect(announced()).toBe(1)

    const failed = await service.search(request('crash'))
    expect(failed?.error).toMatch(/stopped/)
    expect(await service.search(request('wood'))).toMatchObject({ error: null })
    // The restart is not announced, so the window does not rerun the query that killed it.
    expect(announced()).toBe(1)
  })

  it('restarts the thread for every new search, however often it died', async () => {
    const { service } = start()
    for (let i = 0; i < 5; i++) expect((await service.search(request('crash')))?.error).toMatch(/stopped/)
    expect(await service.search(request('wood'))).toMatchObject({ error: null })
  })

  it('announces a rebuild the thread took but died before doing', async () => {
    const { service, announced } = start()
    await service.search(request('wood'))
    const failed = service.search(request('crash'))
    // Fires while the thread is busy with the crashing search: the build waits behind it.
    service.invalidate(0)
    expect((await failed)?.error).toMatch(/stopped/)
    await service.search(request('wood'))
    expect(announced()).toBe(2)
  })

  it('still announces the next rebuild when a quiet restart could not build', async () => {
    const { service, announced } = start()
    await service.search(request('wood'))
    await service.search(request('crash'))
    process.env.FAKE_SEARCH_FAIL_FIRST_BUILD = '1'
    await service.search(request('wood'))
    expect(announced()).toBe(1)
    service.invalidate(0)
    await vi.waitFor(() => expect(announced()).toBe(2))
  })

  it('does not start a thread once stopped', async () => {
    const { service } = start()
    service.stop()
    expect(await service.search(request('wood'))).toBeNull()
  })
})
