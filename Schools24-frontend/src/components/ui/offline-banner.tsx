"use client"

import { useEffect, useRef, useState } from 'react'
import { useOnlineStatus } from '@/hooks/useOnlineStatus'
import { WifiOff, Wifi, X } from 'lucide-react'

/**
 * Enterprise-grade offline/reconnected notification.
 *
 * Renders as a compact card in the bottom-right corner — not a
 * disruptive full-width bar. Slides in instantly when api.ts fires the
 * `app:offline` custom event (before the browser's own `offline` fires),
 * and auto-dismisses 4 s after reconnecting.
 */
export function OfflineBanner() {
  const isOnline = useOnlineStatus()
  const [visible, setVisible] = useState(false)
  const [phase, setPhase] = useState<'offline' | 'reconnected'>('offline')
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (dismissTimer.current) clearTimeout(dismissTimer.current)

    if (!isOnline) {
      setPhase('offline')
      setVisible(true)
    } else if (visible) {
      // Was showing the offline card — transition to "reconnected" then auto-hide
      setPhase('reconnected')
      dismissTimer.current = setTimeout(() => setVisible(false), 4000)
    }
    return () => {
      if (dismissTimer.current) clearTimeout(dismissTimer.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOnline])

  if (!visible) return null

  const isReconnected = phase === 'reconnected'

  return (
    <div
      role="status"
      aria-live="assertive"
      data-phase={phase}
      className={`
        fixed bottom-6 right-6 z-[9999]
        w-[22rem] max-w-[calc(100vw-3rem)]
        rounded-2xl border shadow-2xl shadow-black/20
        backdrop-blur-md
        flex items-start gap-3.5 p-4
        transition-all duration-500 ease-out
        animate-slide-in-right
        ${isReconnected
          ? 'bg-[hsl(var(--card))] border-emerald-500/40 dark:border-emerald-500/30'
          : 'bg-[hsl(var(--card))] border-rose-500/40 dark:border-rose-500/30'
        }
      `}
    >
      {/* Icon */}
      <div
        className={`
          mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl
          ${isReconnected
            ? 'bg-emerald-500/10 text-emerald-500'
            : 'bg-rose-500/10 text-rose-500'
          }
        `}
      >
        {isReconnected ? (
          <Wifi className="h-4.5 w-4.5" />
        ) : (
          <WifiOff className="h-4.5 w-4.5 animate-pulse" />
        )}
      </div>

      {/* Text */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-foreground leading-snug">
          {isReconnected ? 'Connection Restored' : 'No Internet Connection'}
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground leading-relaxed">
          {isReconnected
            ? 'You\'re back online. Everything is working normally.'
            : 'Unable to reach the server. Check your network settings.'}
        </p>
      </div>

      {/* Dismiss (offline phase only — reconnected auto-dismisses) */}
      {!isReconnected && (
        <button
          onClick={() => setVisible(false)}
          aria-label="Dismiss"
          className="mt-0.5 shrink-0 rounded-lg p-1 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}

      {/* Reconnected progress bar */}
      {isReconnected && (
        <div className="absolute bottom-0 left-0 right-0 h-0.5 rounded-b-2xl overflow-hidden">
          <div className="h-full bg-emerald-500 animate-shrink-width" />
        </div>
      )}
    </div>
  )
}
