import type { SoundPickerApi } from '@shared/api'

declare global {
  interface Window {
    soundpicker: SoundPickerApi
  }
}

export {}
