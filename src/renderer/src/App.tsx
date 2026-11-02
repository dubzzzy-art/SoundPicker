import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import type {
  AddLibraryResult,
  AppInfo,
  FileRow,
  FolderRow,
  IndexStatus,
  KeywordChange,
  LibrarySummary,
  RescanSummary,
  ScanProgress,
  SearchResponse,
  SearchScope,
  SearchSort
} from '@shared/api'
import type { KeywordSummary } from '@shared/keywords'
import { splitWords } from '@shared/words'
import { DatabaseButton } from './components/DatabaseButton'
import { dragFiles, isOutgoingDrag } from './drag'
import { FileList, type SearchView, type SelectModifiers } from './components/FileList'
import { FolderKeywordsDialog } from './components/FolderKeywordsDialog'
import { Inspector } from './components/Inspector'
import { KeywordManager } from './components/KeywordManager'
import { Player } from './components/Player'
import { RescanSummaryDialog } from './components/RescanSummaryDialog'
import { SettingsDialog } from './components/SettingsDialog'
import { Sidebar } from './components/Sidebar'
import { formatCount, formatLength } from './format'
import { CloseIcon, FolderIcon, GearIcon, LogoIcon, SearchIcon, TagIcon } from './icons'
import {
  breadcrumb,
  folderAncestors,
  inheritedKeywords,
  sortFiles,
  visibleTreeRows,
  type InheritedKeyword,
  type SortKey,
  type SortOrder,
  type TreeRow
} from './tree'

const SCOPES: { id: SearchScope; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'name', label: 'Name' },
  { id: 'path', label: 'Path' },
  { id: 'keywords', label: 'Keywords' }
]

const api = window.soundpicker

const PARTIAL_RELOAD_MAX_FILES = 20000

export default function App() {
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [scope, setScope] = useState<SearchScope>('all')
  const [query, setQuery] = useState('')
  const [searchLibraryId, setSearchLibraryId] = useState<number | null>(null)
  const [exact, setExact] = useState(false)
  const [searchResult, setSearchResult] = useState<SearchResponse | null>(null)
  const [searchSort, setSearchSort] = useState<SearchSort>({ key: 'relevance', direction: 1 })
  const [indexVersion, setIndexVersion] = useState(0)
  const searchInput = useRef<HTMLInputElement>(null)
  const [libraries, setLibraries] = useState<LibrarySummary[]>([])
  const [foldersByLibrary, setFoldersByLibrary] = useState<Map<number, FolderRow[]>>(new Map())
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const [selectedFolderId, setSelectedFolderId] = useState<number | null>(null)
  const [includeSubfolders, setIncludeSubfolders] = useState(true)
  const [files, setFiles] = useState<FileRow[]>([])
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [focusedId, setFocusedId] = useState<number | null>(null)
  const lastFocused = useRef<FileRow | null>(null)
  const anchorId = useRef<number | null>(null)
  const keepPicked = useRef<{ fileId: number; folderId: number } | null>(null)
  const [playRequest, setPlayRequest] = useState(0)
  const [sort, setSort] = useState<SortOrder>({ key: 'name', direction: 1 })
  const [progress, setProgress] = useState<ScanProgress | null>(null)
  const [status, setStatus] = useState<IndexStatus | null>(null)
  const [renamingLibraryId, setRenamingLibraryId] = useState<number | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [dropActive, setDropActive] = useState(false)
  const [dataVersion, setDataVersion] = useState(0)
  const [keywords, setKeywords] = useState<KeywordSummary[]>([])
  const [keywordsVersion, setKeywordsVersion] = useState(0)
  const [managerOpen, setManagerOpen] = useState(false)
  const [keywordView, setKeywordView] = useState<KeywordSummary | null>(null)
  const [keywordFiles, setKeywordFiles] = useState<FileRow[]>([])
  const [folderDialogId, setFolderDialogId] = useState<number | null>(null)
  const [rescanSummary, setRescanSummary] = useState<RescanSummary | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [favoriteCount, setFavoriteCount] = useState(0)
  const [favoritesOnly, setFavoritesOnly] = useState(false)
  const [fullScreen, setFullScreen] = useState(false)
  const selectLibraryWhenListed = useRef<number | null>(null)
  const knownLibraries = useRef<Set<number>>(new Set())

  const [filesVersion, setFilesVersion] = useState(0)
  const refresh = useCallback(() => {
    setDataVersion((version) => version + 1)
    setFilesVersion((version) => version + 1)
  }, [])
  // A long list waits for the job to end: rereading it blocks the main process.
  const filesShown = useRef(0)
  const onPartialChange = useCallback(() => {
    setDataVersion((version) => version + 1)
    if (filesShown.current <= PARTIAL_RELOAD_MAX_FILES) setFilesVersion((version) => version + 1)
  }, [])

  useEffect(() => {
    void api.getAppInfo().then(setInfo)
    void api.getStatus().then((current) => {
      setStatus(current)
      setFavoriteCount(current.favorites)
      setProgress(current.job)
    })
    const offProgress = api.onScanProgress((next) => {
      if (next.phase === 'files' || next.phase === 'metadata') {
        setProgress(next)
        return
      }
      setProgress(null)
      if (next.summary && worthShowing(next.summary)) setRescanSummary(next.summary)
      else setToast(finishedMessage(next))
    })
    const offChanged = api.onLibrariesChanged((change) => (change?.partial ? onPartialChange() : refresh()))
    const offRename = api.onRenameRequested(setRenamingLibraryId)
    const offIndex = api.onSearchIndexChanged(() => setIndexVersion((version) => version + 1))
    const offFolderKeywords = api.onFolderKeywordsRequested(setFolderDialogId)
    const offSettings = api.onSettingsRequested(() => setSettingsOpen(true))
    const offFullScreen = api.onFullScreenChanged(setFullScreen)
    return () => {
      offFullScreen()
      offSettings()
      offFolderKeywords()
      offProgress()
      offChanged()
      offRename()
      offIndex()
    }
  }, [refresh, onPartialChange])

  useEffect(() => {
    let stale = false
    void (async () => {
      const list = await api.listLibraries()
      const folderLists = await Promise.all(list.map(async (library) => [library.id, await api.getFolders(library.id)] as const))
      const nextStatus = await api.getStatus()
      if (stale) return

      const folderIds = new Set(folderLists.flatMap(([, folders]) => folders.map((folder) => folder.id)))
      const newRoots = list.filter((library) => !knownLibraries.current.has(library.id)).map((library) => library.rootFolderId)
      knownLibraries.current = new Set(list.map((library) => library.id))
      const pending = list.find((library) => library.id === selectLibraryWhenListed.current)
      if (pending) selectLibraryWhenListed.current = null

      setLibraries(list)
      setFoldersByLibrary(new Map(folderLists))
      setStatus(nextStatus)
      setFavoriteCount(nextStatus.favorites)
      if (newRoots.length > 0) setExpanded((current) => new Set([...current, ...newRoots]))
      setSelectedFolderId((current) => {
        if (pending) return pending.rootFolderId
        if (current !== null && folderIds.has(current)) return current
        return list[0]?.rootFolderId ?? null
      })
    })()
    return () => {
      stale = true
    }
  }, [dataVersion])

  useEffect(() => {
    let stale = false
    void api.listKeywords().then((list) => {
      if (!stale) setKeywords(list)
    })
    return () => {
      stale = true
    }
  }, [dataVersion, keywordsVersion])

  useEffect(() => {
    if (!keywordView) return
    let stale = false
    void api.keywordFiles(keywordView.id).then((list) => {
      if (!stale) setKeywordFiles(list)
    })
    return () => {
      stale = true
    }
  }, [keywordView, dataVersion])

  useEffect(() => {
    if (!keywordView) return
    const current = keywords.find((keyword) => keyword.id === keywordView.id)
    if (!current) setKeywordView(null)
    else if (current.name !== keywordView.name) setKeywordView(current)
  }, [keywords, keywordView])

  const searching = query.trim() !== ''
  const filesLoaded = useRef('')
  useEffect(() => {
    if (selectedFolderId === null) {
      filesLoaded.current = ''
      setFiles([])
      return
    }
    const key = `${selectedFolderId}|${includeSubfolders}|${filesVersion}`
    if (searching || filesLoaded.current === key) return
    let stale = false
    void api.listFiles(selectedFolderId, includeSubfolders).then((list) => {
      if (stale) return
      filesLoaded.current = key
      filesShown.current = list.length
      setFiles(list)
    })
    return () => {
      stale = true
    }
  }, [selectedFolderId, includeSubfolders, filesVersion, searching])

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 5000)
    return () => clearTimeout(timer)
  }, [toast])

  const inKeywordView = keywordView !== null && !searching

  useEffect(() => {
    if (!searching) {
      setSearchResult(null)
      setExact(false)
      return
    }
    let stale = false
    void api.search({ query, scope, libraryId: searchLibraryId, exact, sort: searchSort, favoritesOnly }).then((response) => {
      if (!stale && response) setSearchResult(response)
    })
    return () => {
      stale = true
    }
  }, [searching, query, scope, searchLibraryId, exact, searchSort, favoritesOnly, indexVersion])

  useEffect(() => {
    if (searching) setKeywordView(null)
  }, [searching])

  useEffect(() => {
    if (searchLibraryId !== null && !libraries.some((library) => library.id === searchLibraryId)) setSearchLibraryId(null)
  }, [libraries, searchLibraryId])

  useEffect(() => {
    if (favoriteCount === 0) setFavoritesOnly(false)
  }, [favoriteCount])
  const folderFiles = useMemo(() => (favoritesOnly ? files.filter((file) => file.favorite) : files), [favoritesOnly, files])
  const taggedFiles = useMemo(() => (favoritesOnly ? keywordFiles.filter((file) => file.favorite) : keywordFiles), [favoritesOnly, keywordFiles])
  const sortedFiles = useMemo(() => sortFiles(inKeywordView ? taggedFiles : folderFiles, sort), [inKeywordView, taggedFiles, folderFiles, sort])
  const hitFiles = useMemo(() => searchResult?.hits.map((hit) => hit.file) ?? [], [searchResult])
  const shownFiles = searching ? hitFiles : sortedFiles

  const folderLibraryName = useMemo(() => {
    const names = new Map<number, string>()
    for (const library of libraries) {
      for (const folder of foldersByLibrary.get(library.id) ?? []) names.set(folder.id, library.name)
    }
    return names
  }, [libraries, foldersByLibrary])

  const folderById = useMemo(() => new Map([...foldersByLibrary.values()].flat().map((folder) => [folder.id, folder])), [foldersByLibrary])
  const libraryNames = useMemo(() => new Map(libraries.map((library) => [library.id, library.name])), [libraries])

  const inheritedFor = useMemo(() => {
    const cache = new Map<number, InheritedKeyword[]>()
    return (folderId: number) => {
      let list = cache.get(folderId)
      if (!list) {
        list = inheritedKeywords(folderId, folderById, libraryNames)
        cache.set(folderId, list)
      }
      return list
    }
  }, [folderById, libraryNames])
  const folderKeywordNames = useMemo(() => {
    const cache = new Map<number, string[]>()
    return (folderId: number) => {
      let names = cache.get(folderId)
      if (!names) {
        names = inheritedFor(folderId).map((keyword) => keyword.name)
        cache.set(folderId, names)
      }
      return names
    }
  }, [inheritedFor])

  const searchView = useMemo<SearchView | undefined>(() => {
    if (!searching || !searchResult) return undefined
    return {
      relevance: new Map(searchResult.hits.map((hit) => [hit.file.id, hit.relevance])),
      matchedIn: new Map(searchResult.hits.map((hit) => [hit.file.id, hit.matchedIn])),
      highlights: searchResult.highlights,
      queryKey: JSON.stringify(searchResult.request),
      location: (file) => [folderLibraryName.get(file.folderId) ?? '', ...(file.relDir ? file.relDir.split('/') : [])].join(' › ')
    }
  }, [searching, searchResult, folderLibraryName])

  const focusedFile = useMemo(() => {
    const listed = shownFiles.find((file) => file.id === focusedId) ?? files.find((file) => file.id === focusedId)
    if (listed) return listed
    return lastFocused.current?.id === focusedId ? lastFocused.current : null
  }, [shownFiles, files, focusedId, keywordsVersion])
  lastFocused.current = focusedFile

  const locatedFolderId = (searching || keywordView) && focusedFile ? focusedFile.folderId : null
  const [foldedLocated, setFoldedLocated] = useState<number | null>(null)
  const revealed = useMemo(
    () => (locatedFolderId === null || locatedFolderId === foldedLocated ? [] : folderAncestors(locatedFolderId, folderById)),
    [locatedFolderId, foldedLocated, folderById]
  )
  const treeExpanded = useMemo(() => (revealed.length > 0 ? new Set([...expanded, ...revealed]) : expanded), [expanded, revealed])
  const rows = useMemo(
    () => visibleTreeRows(libraries, foldersByLibrary, treeExpanded, favoritesOnly),
    [libraries, foldersByLibrary, treeExpanded, favoritesOnly]
  )
  const selectedFiles = useMemo(() => shownFiles.filter((file) => selectedIds.has(file.id)), [shownFiles, selectedIds])

  useEffect(() => {
    const kept = keepPicked.current?.folderId === selectedFolderId ? keepPicked.current.fileId : null
    keepPicked.current = null
    setSelectedIds(new Set(kept === null ? [] : [kept]))
    setFocusedId(kept)
    anchorId.current = kept
  }, [selectedFolderId, includeSubfolders, keywordView?.id])

  const applyKeywordChange = (change: KeywordChange) => {
    const edited = new Map(change.files.map((file) => [file.id, file.keywords]))
    const last = lastFocused.current
    if (last && edited.has(last.id)) lastFocused.current = { ...last, keywords: edited.get(last.id)! }
    const patch = (list: FileRow[]) =>
      list.some((file) => edited.has(file.id)) ? list.map((file) => (edited.has(file.id) ? { ...file, keywords: edited.get(file.id)! } : file)) : list
    setFiles(patch)
    setKeywordFiles(patch)
    setSearchResult((current) =>
      current && current.hits.some((hit) => edited.has(hit.file.id))
        ? { ...current, hits: current.hits.map((hit) => (edited.has(hit.file.id) ? { ...hit, file: { ...hit.file, keywords: edited.get(hit.file.id)! } } : hit)) }
        : current
    )
    setKeywordsVersion((version) => version + 1)
  }

  const showFavorite = (file: FileRow, favorite: boolean) => {
    const last = lastFocused.current
    if (last?.id === file.id) lastFocused.current = { ...last, favorite }
    const patch = (list: FileRow[]) => (list.some((row) => row.id === file.id) ? list.map((row) => (row.id === file.id ? { ...row, favorite } : row)) : list)
    setFiles(patch)
    setKeywordFiles(patch)
    setSearchResult((current) =>
      current && current.hits.some((hit) => hit.file.id === file.id)
        ? { ...current, hits: current.hits.map((hit) => (hit.file.id === file.id ? { ...hit, file: { ...hit.file, favorite } } : hit)) }
        : current
    )
  }

  const shiftFolderFavorites = (folderId: number, delta: number) =>
    setFoldersByLibrary((current) => {
      const next = new Map(current)
      for (const [libraryId, folders] of current) {
        if (folders.some((folder) => folder.id === folderId)) {
          next.set(
            libraryId,
            folders.map((folder) => (folder.id === folderId ? { ...folder, favoriteCount: Math.max(0, folder.favoriteCount + delta) } : folder))
          )
        }
      }
      return next
    })

  // Shown at once, before the database answers: a second click must see the first.
  const toggleFavorite = async (file: FileRow) => {
    const favorite = !file.favorite
    const delta = favorite ? 1 : -1
    showFavorite(file, favorite)
    shiftFolderFavorites(file.folderId, delta)
    setFavoriteCount((count) => Math.max(0, count + delta))
    try {
      const change = await api.setFavorite([file.id], favorite)
      setFavoriteCount(change.favorites)
      // The shown row was stale and the database already had this star: the counts stay.
      if (!change.changed.includes(file.id)) shiftFolderFavorites(file.folderId, -delta)
      if (favoritesOnly && searching) setIndexVersion((version) => version + 1)
    } catch {
      // Nothing was saved: put everything back, then reread from the database.
      showFavorite(file, !favorite)
      shiftFolderFavorites(file.folderId, -delta)
      setFavoriteCount((count) => Math.max(0, count - delta))
      refresh()
    }
  }

  const addKeyword = async (fileIds: number[], name: string) => applyKeywordChange(await api.addKeyword(fileIds, name))
  const removeKeyword = async (fileIds: number[], name: string) => applyKeywordChange(await api.removeKeyword(fileIds, name))

  const applyFolderKeywords = (folderId: number, list: string[]) => {
    setFoldersByLibrary((current) => {
      const next = new Map(current)
      for (const [libraryId, folders] of current) {
        if (folders.some((folder) => folder.id === folderId)) {
          next.set(libraryId, folders.map((folder) => (folder.id === folderId ? { ...folder, keywords: list } : folder)))
        }
      }
      return next
    })
    setKeywordsVersion((version) => version + 1)
  }
  const addFolderKeyword = async (folderId: number, name: string) => applyFolderKeywords(folderId, await api.addFolderKeyword(folderId, name))
  const removeFolderKeyword = async (folderId: number, name: string) =>
    applyFolderKeywords(folderId, await api.removeFolderKeyword(folderId, name))

  const keywordFolders = useMemo(
    () => (keywordView ? [...folderById.values()].filter((folder) => folder.keywords.includes(keywordView.name)) : []),
    [keywordView, folderById]
  )

  const openFolder = (folderId: number) => {
    setExpanded((current) => new Set([...current, ...folderAncestors(folderId, folderById)]))
    setQuery('')
    setKeywordView(null)
    setIncludeSubfolders(true)
    setSelectedFolderId(folderId)
  }

  const showInFolder = (file: FileRow) => {
    setExpanded((current) => new Set([...current, ...folderAncestors(file.folderId, folderById)]))
    keepFocus(file)
    setQuery('')
    setKeywordView(null)
    setSelectedFolderId(file.folderId)
  }

  const keepFocus = (file: FileRow) => {
    keepPicked.current = { fileId: file.id, folderId: file.folderId }
    setSelectedIds(new Set([file.id]))
    setFocusedId(file.id)
    anchorId.current = file.id
  }

  const dialogFolder = folderDialogId === null ? null : (folderById.get(folderDialogId) ?? null)
  const dialogLibrary = dialogFolder ? libraries.find((library) => library.id === dialogFolder.libraryId) : undefined

  const keywordsRewritten = refresh

  const showKeywordFiles = (keyword: KeywordSummary) => {
    setManagerOpen(false)
    setQuery('')
    setKeywordView(keyword)
  }

  const selectFile = (file: FileRow, { toggle, range }: SelectModifiers) => {
    if (range && anchorId.current !== null) {
      const from = shownFiles.findIndex((candidate) => candidate.id === anchorId.current)
      const to = shownFiles.findIndex((candidate) => candidate.id === file.id)
      if (from >= 0 && to >= 0) {
        const [a, b] = from < to ? [from, to] : [to, from]
        setSelectedIds(new Set(shownFiles.slice(a, b + 1).map((candidate) => candidate.id)))
        setFocusedId(file.id)
        return
      }
    }
    if (toggle) {
      setSelectedIds((current) => {
        const next = new Set(current)
        if (next.has(file.id)) next.delete(file.id)
        else next.add(file.id)
        return next
      })
      anchorId.current = file.id
      setFocusedId(file.id)
      return
    }
    setSelectedIds(new Set([file.id]))
    anchorId.current = file.id
    setFocusedId(file.id)
    setPlayRequest((request) => request + 1)
  }

  const selectedLibrary = useMemo(() => {
    if (selectedFolderId === null) return null
    for (const library of libraries) {
      if (foldersByLibrary.get(library.id)?.some((folder) => folder.id === selectedFolderId)) return library
    }
    return null
  }, [libraries, foldersByLibrary, selectedFolderId])

  const crumbs = selectedLibrary && selectedFolderId !== null
    ? breadcrumb(selectedLibrary, foldersByLibrary.get(selectedLibrary.id) ?? [], selectedFolderId)
    : []

  const handleAddResult = (result: AddLibraryResult) => {
    if (result.ok) {
      selectLibraryWhenListed.current = result.libraryId
      if (result.restored) setToast('Library restored with its keywords')
      refresh()
    } else if (result.reason === 'error') {
      setToast(result.message)
    }
  }

  const addLibrary = async () => handleAddResult(await api.chooseLibraryFolder())

  const toggle = (row: TreeRow) => {
    setFoldedLocated(locatedFolderId)
    setExpanded((current) => {
      const next = new Set([...current, ...revealed])
      if (row.expanded) next.delete(row.folderId)
      else next.add(row.folderId)
      return next
    })
  }

  const select = (row: TreeRow) => {
    if (row.folderId === locatedFolderId && focusedFile) keepFocus(focusedFile)
    if (revealed.length > 0) setExpanded((current) => new Set([...current, ...revealed]))
    setQuery('')
    setKeywordView(null)
    setSelectedFolderId(row.folderId)
    if (row.hasChildren && !row.expanded) toggle(row)
  }

  const rename = async (libraryId: number, name: string | null) => {
    setRenamingLibraryId(null)
    if (name === null) return
    await api.renameLibrary(libraryId, name)
    refresh()
  }

  const changeSort = (key: SortKey) => {
    if (!searching) {
      setSort((current) => (current.key === key ? { key, direction: current.direction === 1 ? -1 : 1 } : { key, direction: 1 }))
    } else if (key === 'relevance' || key === 'name' || key === 'duration') {
      setSelectedIds(new Set())
      setFocusedId(null)
      anchorId.current = null
      setSearchSort((current) => (current.key === key ? { key, direction: current.direction === 1 ? -1 : 1 } : { key, direction: 1 }))
    }
  }

  const rescanTarget = selectedLibrary?.id ?? (libraries.length === 1 ? libraries[0].id : null)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault()
        searchInput.current?.focus()
        searchInput.current?.select()
      } else if (event.key === 'F5') {
        event.preventDefault()
        if (rescanTarget !== null) void api.rescanLibrary(rescanTarget)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [rescanTarget])

  const onSearchKey = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      if (query) setQuery('')
      else event.currentTarget.blur()
    } else if (event.key === 'ArrowDown') {
      event.preventDefault()
      document.querySelector<HTMLElement>('.file-list')?.focus()
    }
  }

  const dragFromList = (file: FileRow) => {
    const chosen = selectedIds.has(file.id) ? shownFiles.filter((candidate) => selectedIds.has(candidate.id)) : [file]
    const channels = Math.min(2, file.channels ?? 1)
    const length = chosen.reduce((sum, candidate) => sum + (candidate.duration ?? 0), 0)
    const label = {
      badge: chosen.length === 1 ? (channels === 2 ? 'Stereo' : 'Mono') : formatCount(chosen.length),
      title: formatLength(length || null)
    }
    void dragFiles(
      chosen.map((candidate) => candidate.id),
      label
    )
  }

  const menuFile = useRef<FileRow | null>(null)
  const fileMenu = (file: FileRow) => {
    const chosen = selectedIds.has(file.id) ? shownFiles.filter((candidate) => selectedIds.has(candidate.id)) : [file]
    menuFile.current = file
    // Offered where the file's folder is not the open one: in search, a keyword view or with subfolders.
    const elsewhere = searching || keywordView !== null || file.folderId !== selectedFolderId
    void api.showFileMenu(
      chosen.map((candidate) => candidate.id),
      elsewhere ? file.id : null
    )
  }
  const showMenuFileInFolder = useRef(showInFolder)
  showMenuFileInFolder.current = showInFolder
  useEffect(
    () =>
      api.onShowInLibrariesRequested((fileId) => {
        if (menuFile.current?.id === fileId) showMenuFileInFolder.current(menuFile.current)
      }),
    []
  )

  const onDragOver = (event: DragEvent) => {
    // A sound dragged out of this window is not a library to add.
    if (isOutgoingDrag() || !event.dataTransfer.types.includes('Files')) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
    setDropActive(true)
  }

  const onDrop = async (event: DragEvent) => {
    event.preventDefault()
    setDropActive(false)
    if (isOutgoingDrag()) return
    const file = event.dataTransfer.files[0]
    if (!file) return
    const path = api.pathForFile(file)
    if (!path) {
      setToast('Drop a folder from Explorer or Finder.')
      return
    }
    handleAddResult(await api.addLibrary(path))
  }

  const platform = info?.platform ?? (navigator.userAgent.includes('Mac') ? 'darwin' : 'win32')
  const indexingHere = progress !== null && progress.libraryId === selectedLibrary?.id

  return (
    <div
      className="app"
      data-platform={platform}
      data-full-screen={fullScreen || undefined}
      onDragOver={onDragOver}
      onDragLeave={(event) => {
        if (event.relatedTarget === null) setDropActive(false)
      }}
      onDrop={(event) => void onDrop(event)}
    >
      <header className="titlebar">
        <span className="titlebar-logo">
          <LogoIcon />
        </span>
        <span className="titlebar-name">Sound Picker</span>
        {selectedLibrary && <span className="titlebar-context">— {selectedLibrary.name}</span>}
      </header>

      <div className="body">
        <Sidebar
          rows={rows}
          selectedFolderId={selectedFolderId}
          locatedFolderId={locatedFolderId}
          renamingLibraryId={renamingLibraryId}
          progress={progress}
          onSelect={select}
          onToggle={toggle}
          onLibraryMenu={(libraryId) => void api.showLibraryMenu(libraryId)}
          onFolderMenu={(folderId) => void api.showFolderMenu(folderId)}
          onFolderKeywords={setFolderDialogId}
          onRename={(libraryId, name) => void rename(libraryId, name)}
          onAddLibrary={() => void addLibrary()}
          onCancelIndexing={() => void api.cancelIndexing()}
          favoriteCount={favoriteCount}
          favoritesOnly={favoritesOnly}
          onFavoritesOnly={setFavoritesOnly}
          keywordCount={keywords.length}
          onAllKeywords={() => setManagerOpen(true)}
        />

        <main className="center">
          <div className="toolbar">
            <label className="search">
              <SearchIcon />
              <span className="visually-hidden">Search sounds</span>
              <input
                ref={searchInput}
                type="search"
                placeholder="Search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={onSearchKey}
                disabled={libraries.length === 0}
              />
              {query ? (
                <button className="search-clear" aria-label="Clear search" onClick={() => setQuery('')}>
                  <CloseIcon />
                </button>
              ) : (
                <kbd className="mono">{platform === 'darwin' ? '⌘ F' : 'Ctrl F'}</kbd>
              )}
            </label>
            <div className="segmented" role="group" aria-label="Search in">
              {SCOPES.map((s) => (
                <button key={s.id} aria-pressed={scope === s.id} onClick={() => setScope(s.id)}>
                  {s.label}
                </button>
              ))}
            </div>
            {libraries.length > 1 && (
              <select
                className="library-filter"
                aria-label="Search in library"
                value={searchLibraryId ?? ''}
                onChange={(event) => setSearchLibraryId(event.target.value === '' ? null : Number(event.target.value))}
              >
                <option value="">All libraries</option>
                {libraries.map((library) => (
                  <option key={library.id} value={library.id}>
                    {library.name}
                  </option>
                ))}
              </select>
            )}
          </div>

          {searching ? (
            <>
              <div className="pathbar search-summary">
                {exact ? (
                  <>
                    <span>Exact search, no typos</span>
                    <button className="link-button" onClick={() => setExact(false)}>
                      Allow typos
                    </button>
                  </>
                ) : searchResult && searchResult.corrections.length > 0 ? (
                  <>
                    <span className="muted">Matching</span>
                    {searchResult.corrections.map((correction) => (
                      <button
                        key={correction.from}
                        className="correction"
                        title={`Replace “${correction.from}” with “${correction.to}” in the search`}
                        onClick={() => setQuery(applyCorrection(query, correction))}
                      >
                        <s>{correction.from}</s> {correction.to}
                      </button>
                    ))}
                    <button className="link-button" onClick={() => setExact(true)}>
                      Search exactly “{query.trim()}”
                    </button>
                  </>
                ) : (
                  <span className="muted">Results for “{query.trim()}”</span>
                )}
                <span className="statusbar-spacer" />
                {searchResult && !searchResult.error && (
                  <span className="mono muted">
                    {formatCount(searchResult.total)} {searchResult.total === 1 ? 'result' : 'results'}
                    {` · ${searchResult.elapsedMs} ms`}
                  </span>
                )}
              </div>
              {shownFiles.length > 0 ? (
                <FileList
                  files={shownFiles}
                  sort={searchSort}
                  selectedIds={selectedIds}
                  focusedId={focusedId}
                  onSort={changeSort}
                  onSelect={selectFile}
                  onDragOut={dragFromList}
                  onContextMenu={fileMenu}
                  onToggleFavorite={(file) => void toggleFavorite(file)}
                  folderKeywords={folderKeywordNames}
                  search={searchView}
                />
              ) : (
                <div className="list-empty">
                  <p className="empty-title">
                    {!searchResult ? 'Searching…' : searchResult.error ? 'Search failed' : `Nothing matches “${query.trim()}”`}
                  </p>
                  {searchResult?.error && <p className="empty-text">{searchResult.error}</p>}
                  {searchResult && !searchResult.error && (
                    <p className="empty-text">
                      {favoritesOnly
                        ? 'Only favorites are searched — turn off Favorites only to search everything.'
                        : exact
                          ? 'Exact search is on — allow typos to find near matches.'
                          : 'Try fewer words, or search in All.'}
                    </p>
                  )}
                </div>
              )}
            </>
          ) : keywordView ? (
            <>
              <div className="pathbar">
                <span className="keyword-view-title">
                  <TagIcon size={14} />
                  Files tagged <span className="keyword-view-name">{keywordView.name}</span>
                </span>
                <button className="link-button" onClick={() => setManagerOpen(true)}>
                  All keywords
                </button>
                <span className="statusbar-spacer" />
                <span className="mono muted">{formatCount(taggedFiles.length)} files</span>
                <button className="icon-button icon-button--small" aria-label="Back to the folder" title="Back to the folder" onClick={() => setKeywordView(null)}>
                  <CloseIcon />
                </button>
              </div>
              {keywordFolders.length > 0 && (
                <div className="pathbar keyword-folders">
                  <span className="muted">Also on folders — everything below them is found by it:</span>
                  {keywordFolders.map((folder) => (
                    <button key={folder.id} className="correction" title={folder.relPath || undefined} onClick={() => openFolder(folder.id)}>
                      <FolderIcon size={12} />
                      {folder.parentId === null ? (libraryNames.get(folder.libraryId) ?? folder.name) : folder.name}
                    </button>
                  ))}
                </div>
              )}
              {taggedFiles.length > 0 ? (
                <FileList
                  files={sortedFiles}
                  sort={sort}
                  selectedIds={selectedIds}
                  focusedId={focusedId}
                  onSort={changeSort}
                  onSelect={selectFile}
                  onDragOut={dragFromList}
                  onContextMenu={fileMenu}
                  onToggleFavorite={(file) => void toggleFavorite(file)}
                  folderKeywords={folderKeywordNames}
                />
              ) : (
                <div className="list-empty">
                  <p className="empty-title">
                    {keywordFiles.length > 0 ? `No favorites tagged “${keywordView.name}”` : `No files tagged “${keywordView.name}”`}
                  </p>
                  <p className="empty-text">
                    {keywordFiles.length > 0
                      ? 'Turn off Favorites only to see every file.'
                      : 'It is only on folders: open one above to see the files it covers.'}
                  </p>
                </div>
              )}
            </>
          ) : selectedLibrary ? (
            <>
              <div className="pathbar">
                <nav className="crumbs" aria-label="Current folder">
                  {crumbs.map((name, index) => (
                    <span key={index} className={index === crumbs.length - 1 ? 'crumb is-current' : 'crumb'}>
                      {index > 0 && <span className="crumb-sep" aria-hidden="true">›</span>}
                      {name}
                    </span>
                  ))}
                </nav>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={includeSubfolders}
                    onChange={(event) => setIncludeSubfolders(event.target.checked)}
                  />
                  Include subfolders
                </label>
                <span className="mono muted">{formatCount(folderFiles.length)} files</span>
              </div>
              {folderFiles.length > 0 ? (
                <FileList
                  files={sortedFiles}
                  sort={sort}
                  selectedIds={selectedIds}
                  focusedId={focusedId}
                  onSort={changeSort}
                  onSelect={selectFile}
                  onDragOut={dragFromList}
                  onContextMenu={fileMenu}
                  onToggleFavorite={(file) => void toggleFavorite(file)}
                  folderKeywords={folderKeywordNames}
                />
              ) : (
                <div className="list-empty">
                  <p className="empty-title">
                    {favoritesOnly && files.length > 0 ? 'No favorites in this folder' : indexingHere ? 'Indexing…' : 'No sounds in this folder'}
                  </p>
                  <p className="empty-text">
                    {favoritesOnly && files.length > 0
                      ? 'Turn off Favorites only to see every file.'
                      : indexingHere
                        ? 'Files appear here as they are found.'
                        : 'Only .mp3 and .wav files are listed.'}
                  </p>
                </div>
              )}
            </>
          ) : (
            <div className="list-empty">
              <span className="empty-icon empty-icon--large">
                <FolderIcon size={28} />
              </span>
              <p className="empty-title">Add a library to start browsing</p>
              <p className="empty-text">Choose a folder with your sounds or drop it anywhere in this window.</p>
              <button className="primary-button" onClick={() => void addLibrary()}>
                Add library
              </button>
            </div>
          )}

          <Player file={focusedFile} playRequest={playRequest} />
        </main>

        <Inspector
          file={focusedFile}
          selectedCount={selectedFiles.length}
          selectedFiles={selectedFiles}
          keywords={keywords}
          onAddKeyword={(fileIds, name) => void addKeyword(fileIds, name)}
          onRemoveKeyword={(fileIds, name) => void removeKeyword(fileIds, name)}
          inheritedFor={inheritedFor}
          onOpenFolder={setFolderDialogId}
        />
      </div>

      <footer className="statusbar mono">
        <span>
          {formatCount(status?.libraries ?? 0)} {status?.libraries === 1 ? 'library' : 'libraries'} ·{' '}
          {formatCount(status?.files ?? 0)} files indexed
        </span>
        {progress && <span className="status-busy">{progressLabel(progress)}</span>}
        <span className="statusbar-spacer" />
        {info && !info.database.ok && (
          <span className="status-error" title={info.database.error ?? undefined}>
            Index: error — see log
          </span>
        )}
        <DatabaseButton platform={platform} refreshKey={status} />
        <button className="statusbar-button" onClick={() => setSettingsOpen(true)} title={platform === 'darwin' ? 'Settings (⌘,)' : 'Settings'}>
          <GearIcon size={12} />
          Settings
        </button>
        <span>v{info?.version ?? '—'}</span>
      </footer>

      {dropActive && (
        <div className="drop-overlay" aria-hidden="true">
          <div className="drop-zone">
            <FolderIcon size={30} />
            <p className="drop-title">Drop a folder to add it as a library</p>
            <p className="empty-text">Every .mp3 and .wav inside is indexed. Nothing is copied or moved.</p>
          </div>
        </div>
      )}

      {dialogFolder && dialogLibrary && (
        <FolderKeywordsDialog
          folder={dialogFolder}
          folders={foldersByLibrary.get(dialogLibrary.id) ?? []}
          libraryName={dialogLibrary.name}
          rootPath={dialogLibrary.rootPath}
          platform={platform}
          catalog={keywords}
          fromParents={dialogFolder.parentId === null ? [] : inheritedFor(dialogFolder.parentId)}
          onAdd={(name) => void addFolderKeyword(dialogFolder.id, name)}
          onRemove={(name) => void removeFolderKeyword(dialogFolder.id, name)}
          onOpenFolder={setFolderDialogId}
          onClose={() => setFolderDialogId(null)}
        />
      )}

      {rescanSummary && (
        <RescanSummaryDialog
          summary={rescanSummary}
          libraryName={libraryNames.get(rescanSummary.libraryId) ?? 'Library'}
          folders={foldersByLibrary.get(rescanSummary.libraryId) ?? []}
          onClose={() => setRescanSummary(null)}
        />
      )}

      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}

      {managerOpen && (
        <KeywordManager
          catalog={keywords}
          onClose={() => setManagerOpen(false)}
          onShowFiles={showKeywordFiles}
          onChanged={keywordsRewritten}
        />
      )}

      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </div>
  )
}

function applyCorrection(query: string, correction: { from: string; to: string }): string {
  const typo = splitWords(query).findLast((word) => word.word === correction.from)
  if (!typo) return query
  return query.slice(0, typo.start) + correction.to + query.slice(typo.end)
}

function progressLabel(progress: ScanProgress): string {
  if (progress.phase === 'metadata') {
    return `Reading details in ${progress.libraryName}… ${formatCount(progress.processed)} / ${formatCount(progress.total)}`
  }
  return `Indexing ${progress.libraryName}… ${formatCount(progress.found)} files`
}

function worthShowing(summary: RescanSummary): boolean {
  return (
    summary.added + summary.moved.length + summary.missing > 0 || summary.missingFiles.length > 0 || summary.missingFolders.length > 0
  )
}

function finishedMessage(progress: ScanProgress): string {
  const name = progress.libraryName
  switch (progress.phase) {
    case 'cancelled':
      return `Indexing of ${name} cancelled`
    case 'error':
      return `${name}: ${progress.message ?? 'indexing failed'}`
    default:
      if (progress.summary) return `${name} is up to date`
      if (progress.found > 0) return `${name} · ${formatCount(progress.found)} files indexed`
      if (progress.processed > 0) return `${name} · file details updated`
      return `No .mp3 or .wav files found in ${name}`
  }
}
