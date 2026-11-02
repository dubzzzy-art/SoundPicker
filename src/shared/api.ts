import type { KeywordSummary } from './keywords'

export interface DatabaseStatus {
  ok: boolean
  engine: 'node:sqlite'
  sqliteVersion: string | null
  error: string | null
}

export interface AppInfo {
  version: string
  platform: string
  electron: string
  database: DatabaseStatus
}

export interface DatabaseInfo {
  path: string
  sizeOnDisk: number
}

export type ThemeSetting = 'system' | 'light' | 'dark'

export interface AppSettings {
  exportFolder: string
  exportFolderIsDefault: boolean
  theme: ThemeSetting
}

export type SetExportFolderResult = { ok: true; settings: AppSettings } | { ok: false; message: string }

export interface LibrarySummary {
  id: number
  name: string
  rootPath: string
  rootFolderId: number
  fileCount: number
  lastScanAt: number | null
}

// fileCount: files directly inside. The library root has relPath ''.
export interface FolderRow {
  id: number
  libraryId: number
  parentId: number | null
  name: string
  relPath: string
  fileCount: number
  favoriteCount: number
  keywords: string[]
}

export type FileStatus = 'ok' | 'missing' | 'broken'

export interface FileRow {
  id: number
  folderId: number
  name: string
  ext: string
  path: string
  relDir: string
  size: number
  duration: number | null
  sampleRate: number | null
  channels: number | null
  bitDepth: number | null
  bitrate: number | null
  status: FileStatus
  keywords: string[]
  favorite: boolean
}

export type ScanPhase = 'files' | 'metadata' | 'done' | 'cancelled' | 'error'

export interface MissingFile {
  id: number
  name: string
  relDir: string
  keywords: string[]
  favorite: boolean
}

export interface MissingFolder {
  id: number
  relPath: string
  keywords: string[]
  suggestedFolderId: number | null
}

export interface RescanLeftovers {
  libraryId: number
  missingFiles: MissingFile[]
  missingFolders: MissingFolder[]
}

export interface RescanSummary extends RescanLeftovers {
  added: number
  moved: { name: string; from: string; to: string }[]
  missing: number
}

export interface ScanProgress {
  libraryId: number
  libraryName: string
  phase: ScanPhase
  found: number
  processed: number
  total: number
  currentPath: string
  message?: string
  summary?: RescanSummary
}

export interface IndexStatus {
  libraries: number
  files: number
  favorites: number
  lastScan: { libraryName: string; at: number } | null
  job: ScanProgress | null
}

export type AddLibraryResult =
  | { ok: true; libraryId: number; restored: boolean }
  | { ok: false; reason: 'cancelled' }
  | { ok: false; reason: 'error'; message: string }

// No range: the whole file. channel: 0 left, 1 right, as a mono file.
export interface ExportRequest {
  fileId: number
  start: number | null
  end: number | null
  channel: 0 | 1 | null
  fades: boolean
  pcm?: { sampleRate: number; channels: Float32Array[] }
}

export type ExportResult = { ok: true; path: string } | { ok: false; message: string }

export interface KeywordChange {
  files: { id: number; keywords: string[] }[]
}

export interface FavoriteChange {
  // The number of starred files.
  favorites: number
  // The files whose star changed; the others already had it as asked.
  changed: number[]
}

export type RenameKeywordResult =
  | { ok: true }
  | { ok: false; reason: 'empty' }
  | { ok: false; reason: 'exists'; existing: KeywordSummary }

export type SearchScope = 'all' | 'name' | 'path' | 'keywords'

export interface SearchRequest {
  query: string
  scope: SearchScope
  // null: every library.
  libraryId: number | null
  exact: boolean
  sort: SearchSort
  favoritesOnly: boolean
}

export interface SearchSort {
  key: 'relevance' | 'name' | 'duration'
  direction: 1 | -1
}

export const MatchedIn = { name: 1, keywords: 2, folderKeywords: 4, path: 8, channels: 16 } as const

export interface SearchHit {
  file: FileRow
  // 0–100.
  relevance: number
  matchedIn: number
}

export interface SearchResponse {
  request: SearchRequest
  hits: SearchHit[]
  total: number
  corrections: { from: string; to: string }[]
  // Length to mark from the word start; 0 for the whole word.
  highlights: Record<string, number>
  elapsedMs: number
  // Set when the search could not run; hits are then empty.
  error: string | null
}

export const WAVEFORM_CACHE_MIN_SECONDS = 30

export const AUDIO_SCHEME = 'sp-audio'

export function audioUrl(fileId: number): string {
  return `${AUDIO_SCHEME}://file/${fileId}`
}

export interface SoundPickerApi {
  getAppInfo(): Promise<AppInfo>
  getStatus(): Promise<IndexStatus>
  listLibraries(): Promise<LibrarySummary[]>
  getFolders(libraryId: number): Promise<FolderRow[]>
  listFiles(folderId: number, includeSubfolders: boolean): Promise<FileRow[]>
  chooseLibraryFolder(): Promise<AddLibraryResult>
  addLibrary(path: string): Promise<AddLibraryResult>
  pathForFile(file: File): string
  showLibraryMenu(libraryId: number): Promise<void>
  renameLibrary(libraryId: number, name: string): Promise<void>
  removeLibrary(libraryId: number): Promise<boolean>
  cancelIndexing(): Promise<void>
  revealFile(fileId: number): Promise<void>
  readPeaks(fileId: number): Promise<Uint8Array | null>
  writePeaks(fileId: number, data: Uint8Array): Promise<void>
  getDatabaseInfo(): Promise<DatabaseInfo>
  exportAudio(request: ExportRequest): Promise<ExportResult>
  prepareExport(request: ExportRequest): void
  // Only paths returned by exportAudio are accepted.
  dragExported(paths: string[], icon: Uint8Array): void
  dragFiles(fileIds: number[], icon: Uint8Array): void
  revealDatabase(): Promise<void>
  openExportFolder(): Promise<void>
  listKeywords(): Promise<KeywordSummary[]>
  addKeyword(fileIds: number[], name: string): Promise<KeywordChange>
  removeKeyword(fileIds: number[], name: string): Promise<KeywordChange>
  renameKeyword(keywordId: number, name: string): Promise<RenameKeywordResult>
  mergeKeyword(sourceId: number, targetId: number): Promise<void>
  deleteKeyword(keywordId: number): Promise<void>
  keywordFiles(keywordId: number): Promise<FileRow[]>
  setFavorite(fileIds: number[], favorite: boolean): Promise<FavoriteChange>
  addFolderKeyword(folderId: number, name: string): Promise<string[]>
  removeFolderKeyword(folderId: number, name: string): Promise<string[]>
  showFolderMenu(folderId: number): Promise<void>
  // showInLibraries: the file the menu offers to show, answered through onShowInLibrariesRequested.
  showFileMenu(fileIds: number[], showInLibraries: number | null): Promise<void>
  onShowInLibrariesRequested(listener: (fileId: number) => void): () => void
  onFolderKeywordsRequested(listener: (folderId: number) => void): () => void
  rescanLibrary(libraryId: number): Promise<void>
  rescanLeftovers(libraryId: number): Promise<RescanLeftovers>
  // null: every missing file of the library.
  clearMissingFiles(libraryId: number, fileIds: number[] | null): Promise<RescanLeftovers>
  // null: drop the keywords.
  moveFolderKeywords(fromFolderId: number, toFolderId: number | null): Promise<RescanLeftovers>
  getSettings(): Promise<AppSettings>
  chooseExportFolder(): Promise<AppSettings>
  setExportFolder(path: string): Promise<SetExportFolderResult>
  setTheme(theme: ThemeSetting): Promise<AppSettings>
  onSettingsRequested(listener: () => void): () => void
  onFullScreenChanged(listener: (fullScreen: boolean) => void): () => void
  // null: a newer query overtook this one.
  search(request: SearchRequest): Promise<SearchResponse | null>
  onSearchIndexChanged(listener: () => void): () => void
  onScanProgress(listener: (progress: ScanProgress) => void): () => void
  onLibrariesChanged(listener: (change: { partial: boolean } | undefined) => void): () => void
  onRenameRequested(listener: (libraryId: number) => void): () => void
}

export const IpcChannel = {
  getAppInfo: 'app:get-info',
  getStatus: 'index:get-status',
  listLibraries: 'library:list',
  getFolders: 'library:folders',
  listFiles: 'library:files',
  chooseLibraryFolder: 'library:choose',
  addLibrary: 'library:add',
  showLibraryMenu: 'library:menu',
  renameLibrary: 'library:rename',
  removeLibrary: 'library:remove',
  cancelIndexing: 'index:cancel',
  revealFile: 'file:reveal',
  readPeaks: 'peaks:read',
  writePeaks: 'peaks:write',
  getDatabaseInfo: 'database:info',
  exportAudio: 'export:audio',
  prepareExport: 'export:prepare',
  dragExported: 'drag:exported',
  dragFiles: 'drag:files',
  revealDatabase: 'database:reveal',
  openExportFolder: 'export:open-folder',
  listKeywords: 'keywords:list',
  addKeyword: 'keywords:add',
  removeKeyword: 'keywords:remove',
  renameKeyword: 'keywords:rename',
  mergeKeyword: 'keywords:merge',
  deleteKeyword: 'keywords:delete',
  keywordFiles: 'keywords:files',
  setFavorite: 'files:favorite',
  addFolderKeyword: 'keywords:folder-add',
  removeFolderKeyword: 'keywords:folder-remove',
  showFolderMenu: 'folder:menu',
  showFileMenu: 'file:menu',
  showInLibrariesRequested: 'file:show-in-libraries',
  folderKeywordsRequested: 'folder:keywords-requested',
  rescanLibrary: 'library:rescan',
  rescanLeftovers: 'library:leftovers',
  clearMissingFiles: 'library:clear-missing',
  moveFolderKeywords: 'library:move-folder-keywords',
  getSettings: 'settings:get',
  chooseExportFolder: 'settings:choose-export-folder',
  setExportFolder: 'settings:set-export-folder',
  setTheme: 'settings:set-theme',
  settingsRequested: 'settings:requested',
  fullScreenChanged: 'window:full-screen-changed',
  search: 'search:query',
  searchIndexChanged: 'search:index-changed',
  scanProgress: 'index:progress',
  librariesChanged: 'library:changed',
  renameRequested: 'library:rename-requested'
} as const
