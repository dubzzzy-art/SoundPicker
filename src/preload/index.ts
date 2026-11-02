import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'
import { IpcChannel, type ScanProgress, type SoundPickerApi } from '../shared/api'

function subscribe<T>(channel: string, listener: (payload: T) => void): () => void {
  const handler = (_event: IpcRendererEvent, payload: T) => listener(payload)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

const api: SoundPickerApi = {
  getAppInfo: () => ipcRenderer.invoke(IpcChannel.getAppInfo),
  getStatus: () => ipcRenderer.invoke(IpcChannel.getStatus),
  listLibraries: () => ipcRenderer.invoke(IpcChannel.listLibraries),
  getFolders: (libraryId) => ipcRenderer.invoke(IpcChannel.getFolders, libraryId),
  listFiles: (folderId, includeSubfolders) => ipcRenderer.invoke(IpcChannel.listFiles, folderId, includeSubfolders),
  chooseLibraryFolder: () => ipcRenderer.invoke(IpcChannel.chooseLibraryFolder),
  addLibrary: (path) => ipcRenderer.invoke(IpcChannel.addLibrary, path),
  pathForFile: (file) => webUtils.getPathForFile(file),
  showLibraryMenu: (libraryId) => ipcRenderer.invoke(IpcChannel.showLibraryMenu, libraryId),
  renameLibrary: (libraryId, name) => ipcRenderer.invoke(IpcChannel.renameLibrary, libraryId, name),
  removeLibrary: (libraryId) => ipcRenderer.invoke(IpcChannel.removeLibrary, libraryId),
  cancelIndexing: () => ipcRenderer.invoke(IpcChannel.cancelIndexing),
  revealFile: (fileId) => ipcRenderer.invoke(IpcChannel.revealFile, fileId),
  readPeaks: (fileId) => ipcRenderer.invoke(IpcChannel.readPeaks, fileId),
  writePeaks: (fileId, data) => ipcRenderer.invoke(IpcChannel.writePeaks, fileId, data),
  getDatabaseInfo: () => ipcRenderer.invoke(IpcChannel.getDatabaseInfo),
  exportAudio: (request) => ipcRenderer.invoke(IpcChannel.exportAudio, request),
  prepareExport: (request) => ipcRenderer.send(IpcChannel.prepareExport, request),
  dragExported: (paths, icon) => ipcRenderer.send(IpcChannel.dragExported, paths, icon),
  dragFiles: (fileIds, icon) => ipcRenderer.send(IpcChannel.dragFiles, fileIds, icon),
  revealDatabase: () => ipcRenderer.invoke(IpcChannel.revealDatabase),
  openExportFolder: () => ipcRenderer.invoke(IpcChannel.openExportFolder),
  listKeywords: () => ipcRenderer.invoke(IpcChannel.listKeywords),
  addKeyword: (fileIds, name) => ipcRenderer.invoke(IpcChannel.addKeyword, fileIds, name),
  removeKeyword: (fileIds, name) => ipcRenderer.invoke(IpcChannel.removeKeyword, fileIds, name),
  renameKeyword: (keywordId, name) => ipcRenderer.invoke(IpcChannel.renameKeyword, keywordId, name),
  mergeKeyword: (sourceId, targetId) => ipcRenderer.invoke(IpcChannel.mergeKeyword, sourceId, targetId),
  deleteKeyword: (keywordId) => ipcRenderer.invoke(IpcChannel.deleteKeyword, keywordId),
  keywordFiles: (keywordId) => ipcRenderer.invoke(IpcChannel.keywordFiles, keywordId),
  addFolderKeyword: (folderId, name) => ipcRenderer.invoke(IpcChannel.addFolderKeyword, folderId, name),
  removeFolderKeyword: (folderId, name) => ipcRenderer.invoke(IpcChannel.removeFolderKeyword, folderId, name),
  showFolderMenu: (folderId) => ipcRenderer.invoke(IpcChannel.showFolderMenu, folderId),
  showFileMenu: (fileIds, showInLibraries) => ipcRenderer.invoke(IpcChannel.showFileMenu, fileIds, showInLibraries),
  onShowInLibrariesRequested: (listener) => subscribe<number>(IpcChannel.showInLibrariesRequested, listener),
  onFolderKeywordsRequested: (listener) => subscribe<number>(IpcChannel.folderKeywordsRequested, listener),
  rescanLibrary: (libraryId) => ipcRenderer.invoke(IpcChannel.rescanLibrary, libraryId),
  rescanLeftovers: (libraryId) => ipcRenderer.invoke(IpcChannel.rescanLeftovers, libraryId),
  clearMissingFiles: (libraryId, fileIds) => ipcRenderer.invoke(IpcChannel.clearMissingFiles, libraryId, fileIds),
  moveFolderKeywords: (fromFolderId, toFolderId) => ipcRenderer.invoke(IpcChannel.moveFolderKeywords, fromFolderId, toFolderId),
  getSettings: () => ipcRenderer.invoke(IpcChannel.getSettings),
  chooseExportFolder: () => ipcRenderer.invoke(IpcChannel.chooseExportFolder),
  setFavorite: (fileIds, favorite) => ipcRenderer.invoke(IpcChannel.setFavorite, fileIds, favorite),
  setExportFolder: (path) => ipcRenderer.invoke(IpcChannel.setExportFolder, path),
  setTheme: (theme) => ipcRenderer.invoke(IpcChannel.setTheme, theme),
  onSettingsRequested: (listener) => subscribe<void>(IpcChannel.settingsRequested, listener),
  onFullScreenChanged: (listener) => subscribe<boolean>(IpcChannel.fullScreenChanged, listener),
  search: (request) => ipcRenderer.invoke(IpcChannel.search, request),
  onSearchIndexChanged: (listener) => subscribe<void>(IpcChannel.searchIndexChanged, listener),
  onScanProgress: (listener) => subscribe<ScanProgress>(IpcChannel.scanProgress, listener),
  onLibrariesChanged: (listener) => subscribe<{ partial: boolean } | undefined>(IpcChannel.librariesChanged, listener),
  onRenameRequested: (listener) => subscribe<number>(IpcChannel.renameRequested, listener)
}

contextBridge.exposeInMainWorld('soundpicker', api)
