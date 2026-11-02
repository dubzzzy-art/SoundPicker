import type { FileRow } from '@shared/api'
import type { KeywordSummary } from '@shared/keywords'
import { formatBitrate, formatChannels, formatCount, formatLength, formatSize } from '../format'
import { FileIcon } from '../icons'
import type { InheritedKeyword } from '../tree'
import { byFolder, FolderKeywordList } from './FolderKeywordsDialog'
import { KeywordEditor } from './KeywordEditor'
import { PanelResizer, usePanelWidth, type PanelWidth } from './PanelResizer'

const WIDTH: PanelWidth = { key: 'inspectorWidth', initial: 300, min: 260, max: 560 }

interface InspectorProps {
  file: FileRow | null
  selectedCount: number
  selectedFiles: FileRow[]
  keywords: KeywordSummary[]
  onAddKeyword(fileIds: number[], name: string): void
  onRemoveKeyword(fileIds: number[], name: string): void
  inheritedFor(folderId: number): InheritedKeyword[]
  onOpenFolder(folderId: number): void
}

export function Inspector({ file, selectedCount, selectedFiles, inheritedFor, onOpenFolder, ...keywordProps }: InspectorProps) {
  const [width, setWidth] = usePanelWidth(WIDTH)
  return (
    <aside className="inspector" aria-label="File details" style={{ width }}>
      <PanelResizer edge="left" label="Resize file details" width={width} limits={WIDTH} onResize={setWidth} />
      <div className="inspector-scroll">
        <div className="section-head">
          <h2 className="section-title">{selectedCount > 1 ? 'Selection' : 'File'}</h2>
        </div>
        {selectedCount > 1 ? (
          <SelectionSummary files={selectedFiles} {...keywordProps} />
        ) : file ? (
          <FileDetails
            file={file}
            inherited={inheritedFor(file.folderId)}
            onOpenFolder={onOpenFolder}
            {...keywordProps}
          />
        ) : (
          <div className="inspector-empty">
            <span className="empty-icon">
              <FileIcon size={20} />
            </span>
            <p className="empty-text">Select a file</p>
          </div>
        )}
      </div>
    </aside>
  )
}

type KeywordProps = Pick<InspectorProps, 'keywords' | 'onAddKeyword' | 'onRemoveKeyword'>

function KeywordSection({ files, title, keywords, onAddKeyword, onRemoveKeyword }: KeywordProps & { files: FileRow[]; title: string }) {
  return (
    <section className="inspector-section" aria-label="Keywords">
      <h3 className="section-title">{title}</h3>
      <KeywordEditor files={files} catalog={keywords} onAdd={onAddKeyword} onRemove={onRemoveKeyword} />
    </section>
  )
}

function SelectionSummary({ files, ...keywordProps }: KeywordProps & { files: FileRow[] }) {
  const total = files.reduce((sum, file) => sum + (file.duration ?? 0), 0)
  const size = files.reduce((sum, file) => sum + file.size, 0)
  const formats = [...new Set(files.map((file) => file.ext.toUpperCase()))].join(', ')
  return (
    <>
      <div className="inspector-block">
        <p className="inspector-name">{formatCount(files.length)} files selected</p>
        <p className="inspector-path">
          {files
            .slice(0, 3)
            .map((file) => file.name)
            .join(', ')}
          {files.length > 3 && ` and ${formatCount(files.length - 3)} more`}
        </p>
      </div>
      <KeywordSection files={files} title={`Tagging ${formatCount(files.length)} selected files`} {...keywordProps} />
      <dl className="inspector-grid">
        <div>
          <dt>Total length</dt>
          <dd className="mono">{formatLength(total)}</dd>
        </div>
        <div>
          <dt>Total size</dt>
          <dd className="mono">{formatSize(size)}</dd>
        </div>
        <div>
          <dt>Formats</dt>
          <dd className="mono">{formats}</dd>
        </div>
      </dl>
    </>
  )
}

interface FileDetailsProps extends KeywordProps {
  file: FileRow
  inherited: InheritedKeyword[]
  onOpenFolder(folderId: number): void
}

function FileDetails({ file, inherited, onOpenFolder, ...keywordProps }: FileDetailsProps) {
  const isPcm = file.ext === 'wav'
  const details: [string, string][] = [
    ['Format', file.ext.toUpperCase()],
    ['Duration', formatLength(file.duration)],
    ['Sample rate', file.sampleRate ? `${file.sampleRate.toLocaleString('en-US')} Hz` : '—'],
    [isPcm ? 'Bit depth' : 'Bitrate', isPcm ? (file.bitDepth ? `${file.bitDepth}-bit` : '—') : formatBitrate(file.bitrate)],
    ['Channels', formatChannels(file.channels)],
    ['Size', formatSize(file.size)]
  ]

  return (
    <>
      <div className="inspector-block">
        <p className="inspector-name">{file.name}</p>
        <p className="inspector-path mono">{file.path}</p>
        {file.status === 'broken' && <p className="inspector-warning">This file could not be read.</p>}
        {(file.channels ?? 0) > 2 && (
          <p className="inspector-note">
            This file has {file.channels} channels. Only the first two are shown, played and exported.
          </p>
        )}
      </div>
      <dl className="inspector-grid">
        {details.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd className="mono">{value}</dd>
          </div>
        ))}
      </dl>
      <KeywordSection files={[file]} title="File keywords" {...keywordProps} />
      <section className="inspector-section" aria-label="Keywords from folders">
        <h3 className="section-title">From folders</h3>
        {inherited.length > 0 ? (
          <FolderKeywordList folders={byFolder(inherited)} onOpenFolder={onOpenFolder} />
        ) : (
          <p className="keyword-empty">None of its folders has keywords.</p>
        )}
      </section>
    </>
  )
}
