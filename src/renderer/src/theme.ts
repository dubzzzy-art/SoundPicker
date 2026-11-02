import { useSyncExternalStore } from 'react'

// The window follows the system theme; canvases read the same colors as the CSS.
const light = window.matchMedia('(prefers-color-scheme: light)')

export function cssColor(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

export function isLight(): boolean {
  return light.matches
}

export function useColorScheme(): 'light' | 'dark' {
  return useSyncExternalStore(
    (onChange) => {
      light.addEventListener('change', onChange)
      return () => light.removeEventListener('change', onChange)
    },
    () => (light.matches ? 'light' : 'dark')
  )
}
