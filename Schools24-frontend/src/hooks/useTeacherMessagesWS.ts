/**
 * useTeacherMessagesWS — Real-time WebSocket hook for teacher class-group messages.
 *
 * Connects to /api/v1/teacher/ws?class_id=CLASS_ID&ticket=SHORT_LIVED_TICKET.
 * When a message arrives from the server it is injected directly into the
 * React Query infinite-query cache so the UI updates without a refetch.
 *
 * Behaviour mirrors useChat.ts:
 *  - Retries up to MAX_RECONNECT times with exponential back-off.
 *  - Cleans up (closes socket, cancels retry timer) when the calling component
 *    unmounts or when classId changes.
 *  - Deduplicates incoming WS messages against the existing cache to prevent
 *    doubles if a refetch races with the socket delivery.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useQueryClient, InfiniteData } from '@tanstack/react-query'
import { buildWsBaseUrl, getWSTicket } from '@/lib/ws-ticket'

// ─── Types ───────────────────────────────────────────────────────────────────

/** Shape the backend writes to the WS connection (ClassGroupMessage). */
export interface WsClassGroupMessage {
    id: string
    class_id: string
    sender_id: string
    sender_name: string
    sender_role: string
    content: string
    created_at: string
}

/** Minimal page shape needed to update the cache. */
interface ClassMessagesPage {
    messages: WsClassGroupMessage[]
    page: number
    page_size: number
    has_more: boolean
    next_page: number
}

export type WsStatus = 'connecting' | 'connected' | 'disconnected' | 'error'

export interface UseTeacherMessagesWSReturn {
    wsStatus: WsStatus
}

// ─── Constants ───────────────────────────────────────────────────────────────

const MAX_RECONNECT = 3

// ─── Hook ────────────────────────────────────────────────────────────────────

/**
 * @param classId - UUID of the class whose messages to stream. Pass an empty
 *                  string to disable the socket (no connection is made).
 * @param queryKey - The React Query key of the infinite-query whose cache
 *                   should be updated when a WS message arrives.
 *                   Usually: ['teacher-class-group-messages', classId]
 */
export function useTeacherMessagesWS(
    classId: string,
    queryKey: readonly unknown[]
): UseTeacherMessagesWSReturn {
    const queryClient = useQueryClient()
    const [wsStatus, setWsStatus] = useState<WsStatus>('disconnected')

    const wsRef = useRef<WebSocket | null>(null)
    const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const retryCount = useRef(0)

    // Keep a stable ref to the queryKey so the connect callback doesn't need
    // to list it as a dependency (avoids reconnect on every render).
    const queryKeyRef = useRef(queryKey)
    useEffect(() => {
        queryKeyRef.current = queryKey
    }, [queryKey])

    // ── Core connect ──────────────────────────────────────────────────────────
    const connect = useCallback(() => {
        if (!classId || typeof window === 'undefined') return
        ;(async () => {
            try {
                const { ticket } = await getWSTicket('teacher_messages', { class_id: classId })
                const url =
                    `${buildWsBaseUrl()}/api/v1/teacher/ws` +
                    `?class_id=${encodeURIComponent(classId)}&ticket=${encodeURIComponent(ticket)}`

                setWsStatus('connecting')
                const ws = new WebSocket(url)
                wsRef.current = ws

                ws.onopen = () => {
                    setWsStatus('connected')
                    retryCount.current = 0
                }

                ws.onmessage = (event) => {
                    try {
                        const msg = JSON.parse(event.data as string) as WsClassGroupMessage

                        queryClient.setQueryData<InfiniteData<ClassMessagesPage>>(
                            queryKeyRef.current,
                            (old) => {
                                if (!old || old.pages.length === 0) return old
                                const isDupe = old.pages.some((page) =>
                                    page.messages.some((m) => m.id === msg.id)
                                )
                                if (isDupe) return old
                                const pages = [...old.pages]
                                const lastIdx = pages.length - 1
                                const lastPage = pages[lastIdx]
                                pages[lastIdx] = {
                                    ...lastPage,
                                    messages: [...lastPage.messages, msg],
                                }
                                return { ...old, pages }
                            }
                        )
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
                        const delay = Math.min(1_000 * 2 ** retryCount.current, 10_000)
                        retryCount.current += 1
                        retryTimerRef.current = setTimeout(connect, delay)
                    }
                }
            } catch {
                setWsStatus('error')
            }
        })()
    }, [classId, queryClient])

    // ── Lifecycle ─────────────────────────────────────────────────────────────
    useEffect(() => {
        if (!classId) return

        retryCount.current = 0
        connect()

        return () => {
            if (retryTimerRef.current) clearTimeout(retryTimerRef.current)
            wsRef.current?.close()
            wsRef.current = null
        }
    }, [classId, connect])

    return { wsStatus }
}
