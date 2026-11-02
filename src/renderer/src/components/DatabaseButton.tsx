import { useEffect, useState } from 'react'
import type { DatabaseInfo } from '@shared/api'
import { formatSize } from '../format'
import { DatabaseIcon } from '../icons'

interface DatabaseButtonProps {
  platform: string
  refreshKey: unknown
}

export function DatabaseButton({ platform, refreshKey }: DatabaseButtonProps) {
  const [info, setInfo] = useState<DatabaseInfo | null>(null)

  useEffect(() => {
    void window.soundpicker.getDatabaseInfo().then(setInfo)
  }, [refreshKey])

  const where = platform === 'darwin' ? 'Finder' : 'Explorer'
  return (
    <button
      className="database-button"
      onClick={() => void window.soundpicker.revealDatabase()}
      title={info ? `${info.path}\nClick to show in ${where}` : undefined}
    >
      <DatabaseIcon size={12} />
      {info ? formatSize(info.sizeOnDisk) : 'Database'}
    </button>
  )
}
