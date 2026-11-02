import { BrowserWindow, Menu, dialog, shell } from 'electron'
import { stat } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { IpcChannel, type AddLibraryResult, type IndexStatus } from '../shared/api'
import type { Indexer } from './indexer'
import type { LibraryStore } from './library-store'
import { log } from './log'

export class LibraryService {
  constructor(
    private readonly store: LibraryStore,
    private readonly indexer: Indexer,
    private readonly getWindow: () => BrowserWindow | null,
    private readonly onChanged: () => void = () => {}
  ) {}

  status(): IndexStatus {
    return { ...this.store.totals(), favorites: this.store.favoriteCount(), lastScan: this.store.lastScan(), job: this.indexer.progress }
  }

  async choose(): Promise<AddLibraryResult> {
    const window = this.getWindow()
    const options: Electron.OpenDialogOptions = {
      title: 'Add library',
      buttonLabel: 'Add library',
      properties: ['openDirectory']
    }
    const picked = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options)
    if (picked.canceled || picked.filePaths.length === 0) return { ok: false, reason: 'cancelled' }
    return this.add(picked.filePaths[0])
  }

  async add(path: string): Promise<AddLibraryResult> {
    const rootPath = resolve(path)
    try {
      const info = await stat(rootPath)
      if (!info.isDirectory()) return { ok: false, reason: 'error', message: 'Drop a folder, not a file.' }
    } catch {
      return { ok: false, reason: 'error', message: `Can't open ${rootPath}.` }
    }

    const existing = this.store.findLibraryByRoot(rootPath)
    if (existing && existing.removedAt === null) {
      return { ok: false, reason: 'error', message: `“${existing.name}” is already in Libraries.` }
    }
    if (existing) {
      this.store.restoreLibrary(existing.id, rootPath)
      log('info', `Library restored: ${rootPath}`)
      this.indexer.scan(existing.id, false)
      return { ok: true, libraryId: existing.id, restored: true }
    }

    const name = basename(rootPath) || rootPath
    const libraryId = this.store.createLibrary(name, rootPath)
    log('info', `Library added: ${rootPath}`)
    this.indexer.scan(libraryId, true)
    return { ok: true, libraryId, restored: false }
  }

  showMenu(libraryId: number): void {
    const library = this.store.getLibrary(libraryId)
    const window = this.getWindow()
    if (!library || !window) return

    const menu = Menu.buildFromTemplate([
      {
        label: 'Rescan',
        accelerator: 'F5',
        registerAccelerator: false,
        enabled: this.indexer.activeLibraryId !== libraryId,
        click: () => this.rescan(libraryId)
      },
      {
        label: process.platform === 'darwin' ? 'Open in Finder' : 'Open in Explorer',
        click: () => void shell.openPath(library.rootPath)
      },
      {
        label: 'Rename',
        click: () => window.webContents.send(IpcChannel.renameRequested, libraryId)
      },
      {
        label: 'Change root folder',
        click: () => void this.changeRoot(libraryId)
      },
      {
        label: 'Keywords',
        click: () => {
          const root = this.store.getFolders(libraryId).find((folder) => folder.relPath === '')
          if (root) window.webContents.send(IpcChannel.folderKeywordsRequested, root.id)
        }
      },
      { type: 'separator' },
      {
        label: 'Remove from Libraries',
        click: () => void this.remove(libraryId)
      }
    ])
    menu.popup({ window })
  }

  showFolderMenu(folderId: number): void {
    const path = this.store.folderOnDisk(folderId)
    const window = this.getWindow()
    if (!path || !window) return
    const menu = Menu.buildFromTemplate([
      {
        label: 'Keywords',
        click: () => window.webContents.send(IpcChannel.folderKeywordsRequested, folderId)
      },
      {
        label: process.platform === 'darwin' ? 'Open in Finder' : 'Open in Explorer',
        click: () => void shell.openPath(path)
      }
    ])
    menu.popup({ window })
  }

  rescan(libraryId: number): void {
    const library = this.store.getLibrary(libraryId)
    if (!library || library.removedAt !== null) return
    this.indexer.scan(libraryId, false)
  }

  async changeRoot(libraryId: number): Promise<void> {
    const library = this.store.getLibrary(libraryId)
    const window = this.getWindow()
    if (!library) return
    const options: Electron.OpenDialogOptions = {
      title: `New root folder for ${library.name}`,
      buttonLabel: 'Use this folder',
      defaultPath: library.rootPath,
      properties: ['openDirectory']
    }
    const picked = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options)
    if (picked.canceled || picked.filePaths.length === 0) return
    const rootPath = resolve(picked.filePaths[0])
    const other = this.store.findLibraryByRoot(rootPath)
    if (other && other.id !== libraryId) {
      const message: Electron.MessageBoxOptions = {
        type: 'warning',
        message: `This folder is already the library “${other.name}”.`,
        detail: 'Choose the folder this library moved to.',
        buttons: ['OK']
      }
      if (window) await dialog.showMessageBox(window, message)
      else await dialog.showMessageBox(message)
      return
    }
    this.store.setRoot(libraryId, rootPath)
    log('info', `Library ${library.name} moved: ${library.rootPath} → ${rootPath}`)
    this.onChanged()
    window?.webContents.send(IpcChannel.librariesChanged)
    this.indexer.scan(libraryId, false)
  }

  rename(libraryId: number, name: string): void {
    const trimmed = name.trim()
    if (trimmed === '') return
    this.store.renameLibrary(libraryId, trimmed)
    this.onChanged()
  }

  async remove(libraryId: number): Promise<boolean> {
    const library = this.store.getLibrary(libraryId)
    if (!library) return false
    const keywordCount = this.store.keywordUseCount(libraryId)
    const window = this.getWindow()

    const options: Electron.MessageBoxOptions = {
      type: 'question',
      title: 'Remove library',
      message: `Remove “${library.name}” from Libraries?`,
      detail:
        `Files on disk are not touched.\n\n` +
        (keywordCount === 0
          ? 'This library has no keywords yet.'
          : `This library has ${keywordCount} keyword ${keywordCount === 1 ? 'tag' : 'tags'} on its files and folders.`) +
        ' Kept keywords come back if you add the same folder again.',
      buttons: ['Keep keywords', 'Delete keywords', 'Cancel'],
      defaultId: 0,
      cancelId: 2,
      noLink: true
    }
    const { response } = window ? await dialog.showMessageBox(window, options) : await dialog.showMessageBox(options)
    if (response === 2) return false

    this.indexer.forget(libraryId)
    this.store.removeLibrary(libraryId, response === 0)
    log('info', `Library removed (${response === 0 ? 'keywords kept' : 'keywords deleted'}): ${library.rootPath}`)
    this.onChanged()
    window?.webContents.send(IpcChannel.librariesChanged)
    return true
  }

  resumeUnfinished(): void {
    for (const libraryId of this.store.librariesNeedingDetails()) this.indexer.readDetails(libraryId)
  }
}
