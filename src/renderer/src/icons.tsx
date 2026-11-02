import type { ReactNode } from 'react'

interface IconProps {
  size?: number
}

function Stroke({ size = 16, children }: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

// The app icon (build/icon.svg) drawn for small sizes.
const LOGO_WAVE =
  'M2.8 11.71C2.99 11.71 3.56 11.74 3.95 11.69C4.33 11.64 4.71 11.66 5.1 11.41C5.48 11.16 5.86 10.52 6.25 10.18C6.63 9.84 7.01 9.36 7.4 9.38C7.78 9.4 8.17 10.37 8.55 10.29C8.93 10.2 9.32 9.34 9.7 8.86C10.08 8.38 10.47 7.77 10.85 7.41C11.23 7.04 11.62 6.75 12 6.69C12.38 6.63 12.77 6.77 13.15 7.04C13.53 7.32 13.92 7.92 14.3 8.35C14.68 8.77 15.07 9.28 15.45 9.62C15.83 9.96 16.22 10.34 16.6 10.41C16.99 10.47 17.37 9.9 17.75 10.02C18.14 10.15 18.52 10.88 18.9 11.16C19.29 11.43 19.67 11.58 20.05 11.67C20.44 11.76 21.01 11.7 21.2 11.71L21.2 12.29C21.01 12.3 20.44 12.24 20.05 12.33C19.67 12.42 19.29 12.57 18.9 12.84C18.52 13.12 18.14 13.85 17.75 13.98C17.37 14.1 16.99 13.53 16.6 13.59C16.22 13.66 15.83 14.04 15.45 14.38C15.07 14.72 14.68 15.23 14.3 15.65C13.92 16.08 13.53 16.68 13.15 16.96C12.77 17.23 12.38 17.37 12 17.31C11.62 17.25 11.23 16.96 10.85 16.59C10.47 16.23 10.08 15.62 9.7 15.14C9.32 14.66 8.93 13.8 8.55 13.71C8.17 13.63 7.78 14.6 7.4 14.62C7.01 14.64 6.63 14.16 6.25 13.82C5.86 13.48 5.48 12.84 5.1 12.59C4.71 12.34 4.33 12.36 3.95 12.31C3.56 12.26 2.99 12.29 2.8 12.29Z'

export function LogoIcon({ size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <defs>
        <linearGradient id="logo-tile" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2A303A" />
          <stop offset="1" stopColor="#14171C" />
        </linearGradient>
        <clipPath id="logo-picked">
          <rect x="8.85" y="0" width="6.52" height="24" />
        </clipPath>
      </defs>
      <rect width="24" height="24" rx="5.5" fill="url(#logo-tile)" />
      <path d={LOGO_WAVE} fill="#8B93A0" />
      <rect x="8.85" y="4.37" width="6.52" height="15.26" rx="1" fill="#FFB547" fillOpacity="0.25" />
      <path d={LOGO_WAVE} fill="#FFB547" clipPath="url(#logo-picked)" />
    </svg>
  )
}

export function PlusIcon(props: IconProps) {
  return (
    <Stroke {...props}>
      <path d="M12 5v14M5 12h14" />
    </Stroke>
  )
}

export function SearchIcon(props: IconProps) {
  return (
    <Stroke {...props}>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
    </Stroke>
  )
}

export function FolderIcon(props: IconProps) {
  return (
    <Stroke {...props}>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </Stroke>
  )
}

export function LibraryIcon(props: IconProps) {
  return (
    <Stroke {...props}>
      <rect x="3" y="4" width="18" height="7" rx="1.5" />
      <rect x="3" y="13" width="18" height="7" rx="1.5" />
      <path d="M7 7.5h.01M7 16.5h.01" />
    </Stroke>
  )
}

export function TagIcon(props: IconProps) {
  return (
    <Stroke {...props}>
      <path d="M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z" />
      <path d="M7.5 7.5h.01" />
    </Stroke>
  )
}

export function PlayIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M7 4.5v15l12-7.5z" />
    </svg>
  )
}

export function PauseIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <rect x="6" y="4.5" width="4" height="15" rx="1" />
      <rect x="14" y="4.5" width="4" height="15" rx="1" />
    </svg>
  )
}

export function LoopIcon(props: IconProps) {
  return (
    <Stroke {...props}>
      <path d="M17 2l4 4-4 4" />
      <path d="M3 11V9a3 3 0 0 1 3-3h15" />
      <path d="M7 22l-4-4 4-4" />
      <path d="M21 13v2a3 3 0 0 1-3 3H3" />
    </Stroke>
  )
}

export function RevealIcon(props: IconProps) {
  return (
    <Stroke {...props}>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </Stroke>
  )
}

export function ChevronIcon({ size = 12 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 6l6 6-6 6" />
    </svg>
  )
}

export function CloseIcon({ size = 10 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
      <path d="M2 2l6 6M8 2L2 8" />
    </svg>
  )
}

export function RefreshIcon(props: IconProps) {
  return (
    <Stroke {...props}>
      <path d="M21 12a9 9 0 1 1-3-6.7" />
      <path d="M21 4v5h-5" />
    </Stroke>
  )
}

export function CopyIcon(props: IconProps) {
  return (
    <Stroke {...props}>
      <rect x="8" y="8" width="12" height="12" rx="2" />
      <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
    </Stroke>
  )
}

export function FileIcon(props: IconProps) {
  return (
    <Stroke {...props}>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
    </Stroke>
  )
}

export function DatabaseIcon(props: IconProps) {
  return (
    <Stroke {...props}>
      <ellipse cx="12" cy="5.5" rx="7.5" ry="2.8" />
      <path d="M4.5 5.5v13c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8v-13M4.5 12c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8" />
    </Stroke>
  )
}

export function DragIcon(props: IconProps) {
  return (
    <Stroke {...props}>
      <path d="M9 5h.01M15 5h.01M9 12h.01M15 12h.01M9 19h.01M15 19h.01" strokeWidth="3" />
    </Stroke>
  )
}

export function PencilIcon(props: IconProps) {
  return (
    <Stroke {...props}>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
    </Stroke>
  )
}

export function MergeIcon(props: IconProps) {
  return (
    <Stroke {...props}>
      <path d="M6 3v6a6 6 0 0 0 6 6h6" />
      <path d="M15 12l3 3-3 3" />
      <path d="M18 3v6" />
    </Stroke>
  )
}

export function TrashIcon(props: IconProps) {
  return (
    <Stroke {...props}>
      <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
    </Stroke>
  )
}

export function GearIcon(props: IconProps) {
  return (
    <Stroke {...props}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </Stroke>
  )
}

export function StarIcon({ size = 16, filled = false }: IconProps & { filled?: boolean }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" />
    </svg>
  )
}
