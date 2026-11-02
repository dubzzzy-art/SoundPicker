import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeImage, nativeTheme, shell, type WebContents } from 'electron'
import { statSync } from 'node:fs'
import { mkdir, stat } from 'node:fs/promises'
import { EOL } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import {
  IpcChannel,
  type AppInfo,
  type AppSettings,
  type DatabaseInfo,
  type DatabaseStatus,
  type ExportRequest,
  type FavoriteChange,
  type SearchRequest,
  type SetExportFolderResult,
  type ThemeSetting
} from '../shared/api'
import { handleAudioRequests, registerAudioScheme } from './audio-files'
import { moveChromiumData } from './chromium-data'
import { checkDatabase, failedDatabaseStatus, openDatabase } from './db'
import { ExportService } from './export/export-service'
import { Mp3Encoder } from './export/mp3-encoder'
import mp3WorkerPath from './export/mp3-worker?modulePath'
import { Indexer } from './indexer'
import { LibraryService } from './library-service'
import { KeywordStore } from './keyword-store'
import { LibraryStore } from './library-store'
import { initLog, log } from './log'
import { RescanStore } from './rescan-store'
import scanWorkerPath from './scan/worker?modulePath'
import { INDEXING_REBUILD_GAP_MS, KEYWORD_REBUILD_DELAY_MS, SearchService } from './search/search-service'
import searchWorkerPath from './search/worker?modulePath'
import { SettingsStore } from './settings'

registerAudioScheme()

// The data folder keeps the package name when the shown name changes.
const APP_NAME = 'Sound Picker'
app.setPath('userData', app.getPath('userData'))
app.setName(APP_NAME)

const chromiumFolder = join(app.getPath('userData'), 'Chromium')
const movedChromiumData = moveChromiumData(app.getPath('userData'), chromiumFolder)
app.setPath('sessionData', chromiumFolder)

// Matches --bg and --text-2 in styles.css for the system theme.
const THEME = {
  dark: { background: '#0E1014', symbols: '#A3ABB8' },
  light: { background: '#E9ECF0', symbols: '#4A5160' }
}
const theme = () => (nativeTheme.shouldUseDarkColors ? THEME.dark : THEME.light)
const TITLE_BAR_HEIGHT = 36

let mainWindow: BrowserWindow | null = null
let db: DatabaseSync | null = null
let databaseStatus: DatabaseStatus = failedDatabaseStatus('Database not opened yet')
let store: LibraryStore | null = null
let keywords: KeywordStore | null = null
let rescans: RescanStore | null = null
let settings: SettingsStore | null = null
let indexer: Indexer | null = null
let libraries: LibraryService | null = null
let exports: ExportService | null = null
let search: SearchService | null = null
const mp3Encoder = new Mp3Encoder(mp3WorkerPath)

const MAX_PEAKS_BYTES = 4 + 1024 * 8

function defaultExportFolder(): string {
  return join(app.getPath('documents'), 'Sound Picker Exports')
}

function exportFolder(): string {
  return settings?.get().exportFolder ?? defaultExportFolder()
}

function appSettings(): AppSettings {
  const chosen = settings?.get().exportFolder ?? null
  return {
    exportFolder: chosen ?? defaultExportFolder(),
    exportFolderIsDefault: chosen === null,
    theme: settings?.get().theme ?? 'system'
  }
}

// The window, its title bar and the CSS follow nativeTheme.
function setTheme(theme: ThemeSetting): AppSettings {
  settings?.update({ theme })
  nativeTheme.themeSource = theme
  return appSettings()
}

async function setExportFolder(typed: string): Promise<SetExportFolderResult> {
  const path = typed.trim()
  if (path === '' || resolve(path) === defaultExportFolder()) {
    settings?.update({ exportFolder: null })
    return { ok: true, settings: appSettings() }
  }
  if (!isAbsolute(path)) return { ok: false, message: 'Enter a full path, starting from the drive.' }
  try {
    if (!(await stat(path)).isDirectory()) return { ok: false, message: 'This is a file, not a folder.' }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return { ok: false, message: 'This folder cannot be opened.' }
    try {
      await mkdir(path, { recursive: true })
    } catch {
      return { ok: false, message: 'This folder cannot be created.' }
    }
  }
  settings?.update({ exportFolder: resolve(path) })
  log('info', `Export folder: ${resolve(path)}`)
  return { ok: true, settings: appSettings() }
}

async function chooseExportFolder(): Promise<AppSettings> {
  const options: Electron.OpenDialogOptions = {
    title: 'Export folder',
    buttonLabel: 'Use this folder',
    defaultPath: exportFolder(),
    properties: ['openDirectory', 'createDirectory']
  }
  const picked = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options)
  if (!picked.canceled && picked.filePaths[0]) {
    settings?.update({ exportFolder: picked.filePaths[0] })
    log('info', `Export folder: ${picked.filePaths[0]}`)
  }
  return appSettings()
}

function databaseFile(): string {
  return join(app.getPath('userData'), 'soundpicker.db')
}

function startDatabase(): void {
  const file = databaseFile()
  try {
    db = openDatabase(file)
    databaseStatus = checkDatabase(db)
    log('info', `Database ready at ${file}`, databaseStatus)
  } catch (error) {
    databaseStatus = failedDatabaseStatus(error)
    log('error', `Database failed at ${file}`, error)
  }
}

function sizeOnDisk(file: string): number {
  return [file, `${file}-wal`, `${file}-shm`].reduce((total, part) => {
    try {
      return total + statSync(part).size
    } catch {
      return total
    }
  }, 0)
}

function databaseInfo(): DatabaseInfo {
  const file = databaseFile()
  return { path: file, sizeOnDisk: sizeOnDisk(file) }
}

function startLibraries(): void {
  if (!db) return
  store = new LibraryStore(db)
  keywords = new KeywordStore(db)
  rescans = new RescanStore(db)
  const send = (channel: string, payload?: unknown) => mainWindow?.webContents.send(channel, payload)
  search = new SearchService(searchWorkerPath, databaseFile(), store, () => send(IpcChannel.searchIndexChanged))
  indexer = new Indexer(store, rescans, scanWorkerPath, {
    progress: (progress) => send(IpcChannel.scanProgress, progress),
    librariesChanged: (partial) => {
      search?.invalidate(undefined, partial ? INDEXING_REBUILD_GAP_MS : 0)
      send(IpcChannel.librariesChanged, { partial: partial === true })
    },
    finished: (progress) => {
      log('info', `Indexing ${progress.libraryName} ${progress.phase}`, progress)
      search?.invalidate()
      send(IpcChannel.scanProgress, progress)
    }
  })
  libraries = new LibraryService(store, indexer, () => mainWindow, () => search?.invalidate())
  exports = new ExportService(store, mp3Encoder, exportFolder)
  libraries.resumeUnfinished()
}

function createWindow(): void {
  const isMac = process.platform === 'darwin'

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    show: false,
    title: APP_NAME,
    backgroundColor: theme().background,
    titleBarStyle: 'hidden',
    ...(isMac
      ? { trafficLightPosition: { x: 14, y: 11 } }
      : { titleBarOverlay: { color: theme().background, symbolColor: theme().symbols, height: TITLE_BAR_HEIGHT } }),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.once('ready-to-show', () => mainWindow?.show())
  const followTheme = () => {
    const { background, symbols } = theme()
    mainWindow?.setBackgroundColor(background)
    if (!isMac) mainWindow?.setTitleBarOverlay({ color: background, symbolColor: symbols, height: TITLE_BAR_HEIGHT })
  }
  nativeTheme.on('updated', followTheme)
  mainWindow.on('closed', () => nativeTheme.off('updated', followTheme))
  mainWindow.on('enter-full-screen', () => mainWindow?.webContents.send(IpcChannel.fullScreenChanged, true))
  mainWindow.on('leave-full-screen', () => mainWindow?.webContents.send(IpcChannel.fullScreenChanged, false))

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  // A dropped folder must not navigate the window away.
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault())

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (!app.isPackaged && devUrl) void mainWindow.loadURL(devUrl)
  else void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

function requireLibraries(): LibraryService {
  if (!libraries) throw new Error(databaseStatus.error ?? 'Library index is not available')
  return libraries
}

function requireStore(): LibraryStore {
  if (!store) throw new Error(databaseStatus.error ?? 'Library index is not available')
  return store
}

function requireKeywords(): KeywordStore {
  if (!keywords) throw new Error(databaseStatus.error ?? 'Library index is not available')
  return keywords
}

function editKeywords<T>(edit: (store: KeywordStore) => T): T {
  const result = edit(requireKeywords())
  search?.invalidate(KEYWORD_REBUILD_DELAY_MS)
  return result
}

function requireRescans(): RescanStore {
  if (!rescans) throw new Error(databaseStatus.error ?? 'Library index is not available')
  return rescans
}

function afterLeftoverEdit<T>(result: T): T {
  search?.invalidate(KEYWORD_REBUILD_DELAY_MS)
  mainWindow?.webContents.send(IpcChannel.librariesChanged)
  return result
}

function registerIpc(): void {
  ipcMain.handle(IpcChannel.getAppInfo, (): AppInfo => ({
    version: app.getVersion(),
    platform: process.platform,
    electron: process.versions.electron,
    database: databaseStatus
  }))
  ipcMain.handle(IpcChannel.getStatus, () => requireLibraries().status())
  ipcMain.handle(IpcChannel.listLibraries, () => store?.listLibraries() ?? [])
  ipcMain.handle(IpcChannel.getFolders, (_event, libraryId: number) => requireStore().getFolders(libraryId))
  ipcMain.handle(IpcChannel.listFiles, (_event, folderId: number, includeSubfolders: boolean) =>
    requireStore().listFiles(folderId, includeSubfolders)
  )
  ipcMain.handle(IpcChannel.chooseLibraryFolder, () => requireLibraries().choose())
  ipcMain.handle(IpcChannel.addLibrary, (_event, path: string) => requireLibraries().add(path))
  ipcMain.handle(IpcChannel.showLibraryMenu, (_event, libraryId: number) => requireLibraries().showMenu(libraryId))
  ipcMain.handle(IpcChannel.renameLibrary, (_event, libraryId: number, name: string) =>
    requireLibraries().rename(libraryId, name)
  )
  ipcMain.handle(IpcChannel.removeLibrary, (_event, libraryId: number) => requireLibraries().remove(libraryId))
  ipcMain.handle(IpcChannel.listKeywords, () => keywords?.list() ?? [])
  ipcMain.handle(IpcChannel.addKeyword, (_event, fileIds: number[], name: string) =>
    editKeywords((store) => store.add(fileIds, name))
  )
  ipcMain.handle(IpcChannel.removeKeyword, (_event, fileIds: number[], name: string) =>
    editKeywords((store) => store.remove(fileIds, name))
  )
  ipcMain.handle(IpcChannel.renameKeyword, (_event, keywordId: number, name: string) =>
    editKeywords((store) => store.rename(keywordId, name))
  )
  ipcMain.handle(IpcChannel.mergeKeyword, (_event, sourceId: number, targetId: number) =>
    editKeywords((store) => store.merge(sourceId, targetId))
  )
  ipcMain.handle(IpcChannel.deleteKeyword, (_event, keywordId: number) => editKeywords((store) => store.delete(keywordId)))
  ipcMain.handle(IpcChannel.keywordFiles, (_event, keywordId: number) =>
    requireStore().filesByIds(requireKeywords().fileIds(keywordId))
  )
  ipcMain.handle(IpcChannel.setFavorite, (_event, fileIds: number[], favorite: boolean) => {
    const store = requireStore()
    const changed = store.setFavorite(fileIds, favorite)
    search?.setFavorite(changed, favorite)
    return { favorites: store.favoriteCount(), changed } satisfies FavoriteChange
  })
  ipcMain.handle(IpcChannel.addFolderKeyword, (_event, folderId: number, name: string) =>
    editKeywords((store) => store.addToFolder(folderId, name))
  )
  ipcMain.handle(IpcChannel.removeFolderKeyword, (_event, folderId: number, name: string) =>
    editKeywords((store) => store.removeFromFolder(folderId, name))
  )
  ipcMain.handle(IpcChannel.showFolderMenu, (_event, folderId: number) => requireLibraries().showFolderMenu(folderId))
  ipcMain.handle(IpcChannel.showFileMenu, (event, fileIds: number[], showInLibraries: number | null) => {
    const paths = fileIds.map((id) => store?.fileOnDisk(id)?.path).filter((path): path is string => Boolean(path))
    const window = BrowserWindow.fromWebContents(event.sender)
    if (paths.length === 0 || !window) return
    Menu.buildFromTemplate([
      ...(showInLibraries !== null
        ? [
            { label: 'Show in Libraries', click: () => event.sender.send(IpcChannel.showInLibrariesRequested, showInLibraries) },
            { type: 'separator' as const }
          ]
        : []),
      { label: process.platform === 'darwin' ? 'Open in Finder' : 'Open in Explorer', click: () => shell.showItemInFolder(paths[0]) },
      { label: paths.length === 1 ? 'Copy path' : `Copy ${paths.length} paths`, click: () => clipboard.writeText(paths.join(EOL)) }
    ]).popup({ window })
  })
  ipcMain.handle(IpcChannel.rescanLibrary, (_event, libraryId: number) => requireLibraries().rescan(libraryId))
  ipcMain.handle(IpcChannel.rescanLeftovers, (_event, libraryId: number) => requireRescans().leftovers(libraryId))
  ipcMain.handle(IpcChannel.clearMissingFiles, (_event, libraryId: number, fileIds: number[] | null) =>
    afterLeftoverEdit(requireRescans().clearMissingFiles(libraryId, fileIds))
  )
  ipcMain.handle(IpcChannel.moveFolderKeywords, (_event, fromFolderId: number, toFolderId: number | null) =>
    afterLeftoverEdit(requireRescans().moveFolderKeywords(fromFolderId, toFolderId))
  )
  ipcMain.handle(IpcChannel.getSettings, () => appSettings())
  ipcMain.handle(IpcChannel.chooseExportFolder, () => chooseExportFolder())
  ipcMain.handle(IpcChannel.setExportFolder, (_event, path: string) => setExportFolder(path))
  ipcMain.handle(IpcChannel.setTheme, (_event, theme: ThemeSetting) => setTheme(theme))
  ipcMain.handle(IpcChannel.search, (_event, request: SearchRequest) => search?.search(request) ?? null)
  ipcMain.handle(IpcChannel.cancelIndexing, () => indexer?.cancel())

  ipcMain.handle(IpcChannel.revealFile, (_event, fileId: number) => {
    const file = requireStore().fileOnDisk(fileId)
    if (file) shell.showItemInFolder(file.path)
  })
  ipcMain.handle(IpcChannel.readPeaks, (_event, fileId: number) => requireStore().readPeaks(fileId))
  ipcMain.handle(IpcChannel.writePeaks, (_event, fileId: number, data: unknown) => {
    if (!(data instanceof Uint8Array) || data.length > MAX_PEAKS_BYTES) return
    try {
      requireStore().writePeaks(fileId, data)
    } catch (error) {
      log('warn', 'Could not cache waveform', error)
    }
  })
  ipcMain.handle(IpcChannel.getDatabaseInfo, () => databaseInfo())
  ipcMain.handle(IpcChannel.exportAudio, (_event, request: ExportRequest) => {
    if (!exports) throw new Error(databaseStatus.error ?? 'Library index is not available')
    return exports.export(request)
  })
  ipcMain.on(IpcChannel.prepareExport, (_event, request: ExportRequest) => exports?.prepare(request))
  ipcMain.on(IpcChannel.dragExported, (event, paths: string[], icon: Uint8Array) => {
    dragOut(event.sender, paths.filter((path) => exports?.canDrag(path)), icon)
  })
  ipcMain.on(IpcChannel.dragFiles, (event, fileIds: number[], icon: Uint8Array) => {
    const paths = fileIds.map((id) => store?.fileOnDisk(id)?.path).filter((path): path is string => Boolean(path))
    dragOut(event.sender, paths, icon)
  })
  ipcMain.handle(IpcChannel.revealDatabase, () => shell.showItemInFolder(databaseFile()))
  ipcMain.handle(IpcChannel.openExportFolder, async () => {
    const folder = exportFolder()
    await mkdir(folder, { recursive: true })
    const error = await shell.openPath(folder)
    if (error) log('warn', `Could not open ${folder}`, error)
  })

  handleAudioRequests((fileId) => store?.fileOnDisk(fileId)?.path ?? null)
}

// Windows gets no menu, which also drops the reload shortcuts.
function setApplicationMenu(): void {
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null)
    return
  }
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: APP_NAME,
        submenu: [
          { role: 'about' },
          { type: 'separator' },
          { label: 'Settings', accelerator: 'Cmd+,', click: () => mainWindow?.webContents.send(IpcChannel.settingsRequested) },
          { type: 'separator' },
          { role: 'hide' },
          { role: 'hideOthers' },
          { role: 'unhide' },
          { type: 'separator' },
          { role: 'quit' }
        ]
      },
      { role: 'editMenu' },
      {
        label: 'View',
        submenu: [{ role: 'togglefullscreen' }, { type: 'separator' }, { role: 'toggleDevTools' }]
      },
      { role: 'windowMenu' }
    ])
  )
}

function dragOut(sender: WebContents, paths: string[], icon: Uint8Array): void {
  if (paths.length === 0) return
  let image = nativeImage.createFromBuffer(Buffer.from(icon), { scaleFactor: 2 })
  // macOS refuses a drag without an image.
  if (image.isEmpty()) image = nativeImage.createFromDataURL(FALLBACK_DRAG_ICON)
  sender.startDrag({ file: paths[0], files: paths, icon: image })
}

const FALLBACK_DRAG_ICON =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAGklEQVR4nGP4v9X9PyWYYdSAUQNGDRguBgAAZcT6H6SDIVQAAAAASUVORK5CYII='

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })

  void app.whenReady().then(() => {
    const logFile = initLog(join(app.getPath('userData'), 'logs'))
    log('info', `SoundPicker ${app.getVersion()} starting on ${process.platform}`, { logFile })
    if (movedChromiumData.length > 0) log('info', `Moved Chromium data into ${chromiumFolder}`, movedChromiumData)
    settings = new SettingsStore(join(app.getPath('userData'), 'settings.json'))
    nativeTheme.themeSource = settings.get().theme
    startDatabase()
    startLibraries()
    registerIpc()
    setApplicationMenu()
    createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('will-quit', () => {
    indexer?.cancel()
    mp3Encoder.stop()
    search?.stop()
    db?.close()
    db = null
  })

  process.on('uncaughtException', (error) => log('error', 'Uncaught exception', error))
}
