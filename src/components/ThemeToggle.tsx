'use client'

import { useEffect, useState } from 'react'

export type Theme = 'system' | 'light' | 'dark'

export const THEME_KEY = 'shoebox-theme'

/**
 * Runs before first paint so the page never flashes the wrong theme. Kept as a
 * string because it has to be inlined into <head> ahead of React.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem(${JSON.stringify(
  THEME_KEY,
)});if(t==='light'||t==='dark')document.documentElement.dataset.theme=t;}catch(e){}})();`

const ORDER: Theme[] = ['system', 'light', 'dark']

const LABEL: Record<Theme, string> = {
  system: '跟随系统',
  light: '浅色',
  dark: '深色',
}

function apply(theme: Theme) {
  const root = document.documentElement
  if (theme === 'system') delete root.dataset.theme
  else root.dataset.theme = theme
}

export default function ThemeToggle() {
  // Always start at the server-rendered default; the real value is read in an
  // effect so the first client render matches the HTML.
  const [theme, setTheme] = useState<Theme>('system')
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    const stored = localStorage.getItem(THEME_KEY)
    if (stored === 'light' || stored === 'dark' || stored === 'system') setTheme(stored)
    setMounted(true)
  }, [])

  function cycle() {
    const next = ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length]
    setTheme(next)
    apply(next)
    try {
      if (next === 'system') localStorage.removeItem(THEME_KEY)
      else localStorage.setItem(THEME_KEY, next)
    } catch {
      /* private mode — the choice just won't persist */
    }
  }

  return (
    <button
      className="btn btn-sm theme-btn"
      type="button"
      onClick={cycle}
      title={`主题：${LABEL[theme]}（点击切换）`}
      aria-label={`主题：${LABEL[theme]}，点击切换`}
      // The icon depends on localStorage, so render it only after mount.
      suppressHydrationWarning
    >
      {mounted ? <Icon theme={theme} /> : <span className="theme-icon-space" />}
    </button>
  )
}

function Icon({ theme }: { theme: Theme }) {
  const common = {
    viewBox: '0 0 24 24',
    width: 15,
    height: 15,
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.9,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  }

  if (theme === 'light') {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="4.2" />
        <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.1 5.1l1.4 1.4M17.5 17.5l1.4 1.4M18.9 5.1l-1.4 1.4M6.5 17.5l-1.4 1.4" />
      </svg>
    )
  }
  if (theme === 'dark') {
    return (
      <svg {...common}>
        <path d="M20 13.5A8.2 8.2 0 0 1 10.5 4a8.2 8.2 0 1 0 9.5 9.5Z" />
      </svg>
    )
  }
  return (
    <svg {...common}>
      <rect x="2.5" y="4" width="19" height="13" rx="2" />
      <path d="M8 20.5h8" />
    </svg>
  )
}
