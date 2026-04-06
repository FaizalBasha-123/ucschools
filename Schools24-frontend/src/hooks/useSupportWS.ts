/**
 * useSupportWS — Real-time WebSocket hook for super-admin support tickets.
 *
 * Connects to /api/v1/super-admin/support/ws?ticket=SHORT_LIVED_TICKET (Gorilla WebSocket on
 * the backend). Whenever the server broadcasts a TicketEvent (created |
 * updated | deleted) the relevant React Query caches are invalidated so the
 * ticket list and unread-count refresh automatically.
 *
 * Behaviour:
 *  - Only connects when `enabled` is true (i.e. the SA is on the help-center tab).
 *  - Retries up to MAX_RECONNECT times with exponential back-off on disconnect.
 *  - Cleans up (closes socket, clears timer) on unmount.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { buildWsBaseUrl, getWSTicket } from '@/lib/ws-ticket'

// ─── Types ────────────────────────────────────────────────────────────────────

/** Shape of the TicketEvent the backend broadcasts. */
export interface WsTicketEvent {
    type: 'created' | 'updated' | 'deleted'
    ticket?: unknown
    id?: string
}

export type WsStatus = 'connecting' | 'connected' | 'disconnected' | 'error'

export interface UseSupportWSReturn {
    wsStatus: WsStatus
}

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_RECONNECT = 5

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * @param enabled - Pass `true` when the help-center panel is visible.
 *                  The socket is not opened when `false`.
 */
export function useSupportWS(enabled = true): UseSupportWSReturn {
    const queryClient = useQueryClient()
    const [wsStatus, setWsStatus] = useState<WsStatus>('disconnected')

    const wsRef = useRef<WebSocket | null>(null)
    const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const retryCount = useRef(0)

    const connect = useCallback(() => {
        if (!enabled || typeof window === 'undefined') return
        ;(async () => {
            try {
                const { ticket } = await getWSTicket('support')
                const url =
                    `${buildWsBaseUrl()}/api/v1/super-admin/support/ws` +
                    `?ticket=${encodeURIComponent(ticket)}`

                setWsStatus('connecting')
                const ws = new WebSocket(url)
                wsRef.current = ws

                ws.onopen = () => {
                    setWsStatus('connected')
                    retryCount.current = 0
                }

                ws.onmessage = (event) => {
                    try {
                        const evt = JSON.parse(event.data as string) as WsTicketEvent
                        if (evt.type === 'created' || evt.type === 'updated' || evt.type === 'deleted') {
                            queryClient.invalidateQueries({ queryKey: ['support', 'admin'] })
                            queryClient.invalidateQueries({ queryKey: ['support', 'unread'] })
                        }
                    } catch {
                    }
                }

                ws.onerror = () => {
                    setWsStatus('error')
                }

                ws.onclose = () => {
                    setWsStatus('disconnected')
                    wsRef.current = null

                    if (retryCount.current < MAX_RECONNECT) {
                        const delay = Math.min(1_000 * 2 ** retryCount.current, 15_000)
                        retryCount.current += 1
                        retryTimerRef.current = setTimeout(connect, delay)
                    }
                }
            } catch {
                setWsStatus('error')
            }
        })()
    }, [enabled, queryClient])

    useEffect(() => {
        if (!enabled) return

        retryCount.current = 0
        connect()

        return () => {
            if (retryTimerRef.current) clearTimeout(retryTimerRef.current)
            wsRef.current?.close()
            wsRef.current = null
        }
    }, [enabled, connect])

    return { wsStatus }
}
