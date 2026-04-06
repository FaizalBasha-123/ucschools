"use client"

import { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { usePathname } from 'next/navigation'
import { ArrowUp, X, Sparkles, RotateCcw, WifiOff, Plus, FileText, Maximize2, Minimize2 } from 'lucide-react'
import { useChat, type ChatAttachment, type DataPayload } from '@/hooks/useChat'
import { useAuth } from '@/contexts/AuthContext'

// ─── Bot Avatar — Modern AI Character ────────────────────────────────
type AvatarColors = {
    ambGlow: string
    bodyA: string; bodyB: string; bodyC: string
    faceB: string; faceC: string
    visorA: string; visorB: string; visorC: string
    coreA: string; coreB: string; coreC: string
    eyeA: string; eyeB: string; eyeC: string
}

const AVATAR_COLORS: Record<'indigo' | 'orange' | 'green' | 'violet', AvatarColors> = {
    indigo: {
        ambGlow: '#818cf8',
        bodyA: '#c7d2fe', bodyB: '#a5b4fc', bodyC: '#818cf8',
        faceB: '#eef2ff', faceC: '#e0e7ff',
        visorA: '#6366f1', visorB: '#0ea5e9', visorC: '#06b6d4',
        coreA: '#67e8f9', coreB: '#22d3ee', coreC: '#06b6d4',
        eyeA:  '#a5f3fc', eyeB:  '#22d3ee', eyeC:  '#0891b2',
    },
    orange: {
        ambGlow: '#fb923c',
        bodyA: '#fed7aa', bodyB: '#fdba74', bodyC: '#f97316',
        faceB: '#fff7ed', faceC: '#ffedd5',
        visorA: '#f97316', visorB: '#ea580c', visorC: '#c2410c',
        coreA: '#fde68a', coreB: '#fbbf24', coreC: '#d97706',
        eyeA:  '#fed7aa', eyeB:  '#fb923c', eyeC:  '#ea580c',
    },
    green: {
        ambGlow: '#34d399',
        bodyA: '#a7f3d0', bodyB: '#6ee7b7', bodyC: '#10b981',
        faceB: '#ecfdf5', faceC: '#d1fae5',
        visorA: '#059669', visorB: '#10b981', visorC: '#34d399',
        coreA: '#6ee7b7', coreB: '#34d399', coreC: '#059669',
        eyeA:  '#a7f3d0', eyeB:  '#34d399', eyeC:  '#065f46',
    },
    violet: {
        ambGlow: '#a78bfa',
        bodyA: '#ddd6fe', bodyB: '#c4b5fd', bodyC: '#8b5cf6',
        faceB: '#f5f3ff', faceC: '#ede9fe',
        visorA: '#7c3aed', visorB: '#8b5cf6', visorC: '#a78bfa',
        coreA: '#c4b5fd', coreB: '#a78bfa', coreC: '#7c3aed',
        eyeA:  '#ddd6fe', eyeB:  '#a78bfa', eyeC:  '#5b21b6',
    },
}

let _uidCounter = 0
function BotAvatar({ size = 40, className = '', colors = AVATAR_COLORS.indigo }: { size?: number; className?: string; colors?: AvatarColors }) {
    // stable per-instance uid so multiple SVGs on the same page don't share defs
    const uid = useRef(`av${++_uidCounter}`).current
    const id = (s: string) => `${uid}-${s}`
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 64 64"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className={className}
        >
            {/* Ambient glow */}
            <circle cx="32" cy="32" r="31" fill={`url(#${id('ambGlow')})`} opacity="0.12" />

            {/* Head body — rounded square */}
            <rect x="8" y="12" width="48" height="44" rx="16" fill={`url(#${id('bodyGrad')})`} />
            <rect x="10" y="14" width="44" height="40" rx="14" fill={`url(#${id('faceGrad')})`} />

            {/* Forehead energy core */}
            <circle cx="32" cy="20" r="3.5" fill={`url(#${id('coreGrad')})`} />
            <circle cx="32" cy="20" r="2" fill="white" opacity="0.4" />
            <circle cx="31" cy="19" r="0.8" fill="white" opacity="0.7" />

            {/* Visor / eye band */}
            <rect x="15" y="28" width="34" height="12" rx="6" fill="#0f172a" />
            <rect x="16.5" y="29.5" width="31" height="9" rx="4.5" fill={`url(#${id('visorGrad')})`} opacity="0.85" />

            {/* Left eye — glowing dot */}
            <circle cx="24" cy="34" r="4" fill="#0f172a" />
            <circle cx="24" cy="34" r="3" fill={`url(#${id('eyeDot')})`} />
            <circle cx="22.5" cy="32.5" r="1.5" fill="white" opacity="0.85" />
            <circle cx="25" cy="35.5" r="0.7" fill="white" opacity="0.4" />

            {/* Right eye — glowing dot */}
            <circle cx="40" cy="34" r="4" fill="#0f172a" />
            <circle cx="40" cy="34" r="3" fill={`url(#${id('eyeDot')})`} />
            <circle cx="38.5" cy="32.5" r="1.5" fill="white" opacity="0.85" />
            <circle cx="41" cy="35.5" r="0.7" fill="white" opacity="0.4" />

            {/* Mouth — friendly curve */}
            <path d="M27 46 Q32 51 37 46" stroke="#64748b" strokeWidth="2" strokeLinecap="round" fill="none" />

            {/* Side circuit accents */}
            <rect x="4" y="30" width="5" height="8" rx="2.5" fill={`url(#${id('bodyGrad')})`} opacity="0.7" />
            <circle cx="6.5" cy="34" r="1.5" fill={`url(#${id('coreGrad')})`} opacity="0.6" />
            <rect x="55" y="30" width="5" height="8" rx="2.5" fill={`url(#${id('bodyGrad')})`} opacity="0.7" />
            <circle cx="57.5" cy="34" r="1.5" fill={`url(#${id('coreGrad')})`} opacity="0.6" />

            {/* Antenna */}
            <rect x="30" y="4" width="4" height="9" rx="2" fill={`url(#${id('bodyGrad')})`} />
            <circle cx="32" cy="33" r="3" fill={`url(#${id('coreGrad')})`} />
            <circle cx="31.2" cy="2.2" r="1" fill="white" opacity="0.65" />

            {/* Subtle face shine */}
            <ellipse cx="28" cy="18" rx="12" ry="3.5" fill="white" opacity="0.1" />

            <defs>
                <radialGradient id={id('ambGlow')} cx="0.5" cy="0.5" r="0.5" gradientUnits="objectBoundingBox">
                    <stop stopColor={colors.ambGlow} />
                    <stop offset="1" stopColor={colors.ambGlow} stopOpacity="0" />
                </radialGradient>
                <linearGradient id={id('bodyGrad')} x1="8" y1="12" x2="56" y2="56" gradientUnits="userSpaceOnUse">
                    <stop stopColor={colors.bodyA} />
                    <stop offset="0.5" stopColor={colors.bodyB} />
                    <stop offset="1" stopColor={colors.bodyC} />
                </linearGradient>
                <radialGradient id={id('faceGrad')} cx="0.5" cy="0.3" r="0.6" gradientUnits="objectBoundingBox">
                    <stop stopColor="#f8fafc" />
                    <stop offset="0.5" stopColor={colors.faceB} />
                    <stop offset="1" stopColor={colors.faceC} />
                </radialGradient>
                <linearGradient id={id('visorGrad')} x1="15" y1="28" x2="49" y2="40" gradientUnits="userSpaceOnUse">
                    <stop stopColor={colors.visorA} />
                    <stop offset="0.5" stopColor={colors.visorB} />
                    <stop offset="1" stopColor={colors.visorC} />
                </linearGradient>
                <radialGradient id={id('coreGrad')} cx="0.4" cy="0.35" r="0.6" gradientUnits="objectBoundingBox">
                    <stop stopColor={colors.coreA} />
                    <stop offset="0.5" stopColor={colors.coreB} />
                    <stop offset="1" stopColor={colors.coreC} />
                </radialGradient>
                <radialGradient id={id('eyeDot')} cx="0.4" cy="0.4" r="0.55" gradientUnits="objectBoundingBox">
                    <stop stopColor={colors.eyeA} />
                    <stop offset="0.5" stopColor={colors.eyeB} />
                    <stop offset="1" stopColor={colors.eyeC} />
                </radialGradient>
            </defs>
        </svg>
    )
}

// ─── Types ───────────────────────────────────────────────────────────

// ─── Data Result Renderer ────────────────────────────────────────────

function formatCellValue(v: unknown): string {
    if (v === null || v === undefined || v === '') return '—'
    if (typeof v === 'number') return v.toLocaleString(undefined, { maximumFractionDigits: 2 })
    return String(v)
}

function DataResultRenderer({ payload }: { payload: DataPayload }) {
    const count = payload.rows?.length ?? 0
    const cols = payload.columns ?? []

    if (count === 0) {
        return (
            <div className="mt-1.5 mb-1 py-2 px-3 rounded-lg bg-muted/60 border border-border text-[12px] text-muted-foreground italic">
                No records found.
            </div>
        )
    }

    // Very large result — summary only, nudge to the admin panel
    if (count > 30) {
        return (
            <div className="mt-1.5 mb-1 py-2.5 px-3 rounded-lg bg-amber-50 border border-amber-200 dark:bg-amber-950/30 dark:border-amber-800/40">
                <p className="text-[12px] font-semibold text-amber-800 dark:text-amber-300">{count} records found</p>
                <p className="text-[11px] text-amber-700 dark:text-amber-400 mt-0.5">{payload.summary}</p>
                <p className="text-[11px] text-amber-600 dark:text-amber-500 mt-1">
                    Too many to display here — visit the Admin panel for the full list.
                </p>
            </div>
        )
    }

    // Small result (≤ 5 rows AND ≤ 4 columns) — card layout
    if (count <= 5 && cols.length <= 4) {
        return (
            <div className="mt-1.5 mb-1 space-y-1.5">
                {payload.rows.map((row, i) => (
                    <div key={i} className="py-2 px-3 rounded-lg bg-muted/50 border border-border">
                        {cols.map((col) => (
                            <div key={col} className="flex justify-between items-baseline gap-2 min-w-0">
                                <span className="text-[11px] text-muted-foreground shrink-0">{col}</span>
                                <span className="text-[12px] font-medium text-foreground truncate text-right max-w-[60%]">
                                    {formatCellValue(row[col])}
                                </span>
                            </div>
                        ))}
                    </div>
                ))}
                <p className="text-[10px] text-muted-foreground px-0.5">{payload.summary}</p>
            </div>
        )
    }

    // Medium result — compact scrollable table
    return (
        <div className="mt-1.5 mb-1 rounded-lg border border-border overflow-hidden">
            <div className="overflow-x-auto">
                <table className="w-full text-[11px] border-collapse">
                    <thead>
                        <tr className="bg-muted/80">
                            {cols.map((col) => (
                                <th
                                    key={col}
                                    className="px-2.5 py-1.5 text-left font-semibold text-muted-foreground whitespace-nowrap border-b border-border"
                                >
                                    {col}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {payload.rows.map((row, i) => (
                            <tr
                                key={i}
                                className={i % 2 === 0 ? 'bg-background' : 'bg-muted/25'}
                            >
                                {cols.map((col) => (
                                    <td
                                        key={col}
                                        className="px-2.5 py-1.5 text-foreground whitespace-nowrap max-w-[140px] truncate"
                                        title={formatCellValue(row[col])}
                                    >
                                        {formatCellValue(row[col])}
                                    </td>
                                ))}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            <div className="px-2.5 py-1.5 bg-muted/40 border-t border-border">
                <p className="text-[10px] text-muted-foreground">{payload.summary}</p>
            </div>
        </div>
    )
}

// ─── Component ───────────────────────────────────────────────────────
export default function AdamChatbot() {
    const [isOpen, setIsOpen] = useState(false)
    const [isExpanded, setIsExpanded] = useState(false)
    const [inputValue, setInputValue] = useState('')
    const [pendingAttachment, setPendingAttachment] = useState<ChatAttachment | null>(null)
    const [mounted, setMounted] = useState(false)
    const [isTriggerPopping, setIsTriggerPopping] = useState(false)
    const messagesEndRef = useRef<HTMLDivElement>(null)
    const inputRef = useRef<HTMLInputElement>(null)
    const fileInputRef = useRef<HTMLInputElement>(null)

    const { user, userRole } = useAuth()
    const pathname = usePathname()
    const chatSessionKey = `${user?.id ?? 'anonymous'}:${userRole ?? 'none'}`

    // Role-based colour theme: orange → student, green → teacher, violet → admin, indigo → everyone else
    const theme = userRole === 'student'
        ? {
            headerGrad:   'from-orange-500 via-amber-500 to-orange-500',
            triggerGrad:  'from-orange-500 via-amber-500 to-orange-500',
            triggerShadow:'shadow-[0_10px_30px_-10px_rgba(249,115,22,0.5)]',
            triggerHoverShadow:'hover:shadow-[0_15px_35px_-10px_rgba(249,115,22,0.6)]',
            statusBorder: 'border-orange-500',
            iconBg:       'bg-orange-400/40',
            userBubble:   'bg-orange-500',
            chipColors:   'border-orange-100 bg-orange-50 text-orange-600 hover:bg-orange-100',
            focusRing:    'focus-within:border-ring/50 focus-within:ring-2 focus-within:ring-ring/30',
            sendActive:   'bg-orange-500 hover:bg-orange-600',
            typingDot:    'bg-orange-400',
            clip:         'hover:text-orange-600 hover:bg-orange-50',
            attachWrap:   'bg-orange-50 border-orange-100',
            attachText:   'text-orange-700',
            attachMeta:   'text-orange-400',
            attachIcon:   'text-orange-500',
            attachClose:  'hover:bg-orange-200 text-orange-500',
            msgFileIcon:  'text-orange-500',
            avatarColors: AVATAR_COLORS.orange,
        }
        : userRole === 'teacher'
        ? {
            headerGrad:   'from-emerald-600 via-green-600 to-emerald-600',
            triggerGrad:  'from-emerald-600 via-green-600 to-emerald-600',
            triggerShadow:'shadow-[0_10px_30px_-10px_rgba(5,150,105,0.5)]',
            triggerHoverShadow:'hover:shadow-[0_15px_35px_-10px_rgba(5,150,105,0.6)]',
            statusBorder: 'border-emerald-600',
            iconBg:       'bg-emerald-500/40',
            userBubble:   'bg-emerald-600',
            chipColors:   'border-emerald-100 bg-emerald-50 text-emerald-700 hover:bg-emerald-100',
            focusRing:    'focus-within:border-ring/50 focus-within:ring-2 focus-within:ring-ring/30',
            sendActive:   'bg-emerald-600 hover:bg-emerald-700',
            typingDot:    'bg-emerald-400',
            clip:         'hover:text-emerald-600 hover:bg-emerald-50',
            attachWrap:   'bg-emerald-50 border-emerald-100',
            attachText:   'text-emerald-700',
            attachMeta:   'text-emerald-400',
            attachIcon:   'text-emerald-500',
            attachClose:  'hover:bg-emerald-200 text-emerald-500',
            msgFileIcon:  'text-emerald-500',
            avatarColors: AVATAR_COLORS.green,
        }
        : userRole === 'admin'
        ? {
            headerGrad:   'from-violet-600 via-purple-600 to-violet-600',
            triggerGrad:  'from-violet-600 via-purple-600 to-violet-600',
            triggerShadow:'shadow-[0_10px_30px_-10px_rgba(124,58,237,0.5)]',
            triggerHoverShadow:'hover:shadow-[0_15px_35px_-10px_rgba(124,58,237,0.6)]',
            statusBorder: 'border-violet-600',
            iconBg:       'bg-violet-500/40',
            userBubble:   'bg-violet-600',
            chipColors:   'border-violet-100 bg-violet-50 text-violet-700 hover:bg-violet-100',
            focusRing:    'focus-within:border-ring/50 focus-within:ring-2 focus-within:ring-ring/30',
            sendActive:   'bg-violet-600 hover:bg-violet-700',
            typingDot:    'bg-violet-400',
            clip:         'hover:text-violet-600 hover:bg-violet-50',
            attachWrap:   'bg-violet-50 border-violet-100',
            attachText:   'text-violet-700',
            attachMeta:   'text-violet-400',
            attachIcon:   'text-violet-500',
            attachClose:  'hover:bg-violet-200 text-violet-500',
            msgFileIcon:  'text-violet-500',
            avatarColors: AVATAR_COLORS.violet,
        }
        : {
            headerGrad:   'from-indigo-600 via-blue-600 to-indigo-600',
            triggerGrad:  'from-indigo-600 via-blue-600 to-indigo-600',
            triggerShadow:'shadow-[0_10px_30px_-10px_rgba(79,70,229,0.5)]',
            triggerHoverShadow:'hover:shadow-[0_15px_35px_-10px_rgba(79,70,229,0.6)]',
            statusBorder: 'border-indigo-600',
            iconBg:       'bg-indigo-500/40',
            userBubble:   'bg-indigo-600',
            chipColors:   'border-indigo-100 bg-indigo-50 text-indigo-600 hover:bg-indigo-100',
            focusRing:    'focus-within:border-ring/50 focus-within:ring-2 focus-within:ring-ring/30',
            sendActive:   'bg-indigo-600 hover:bg-indigo-700',
            typingDot:    'bg-indigo-400',
            clip:         'hover:text-indigo-600 hover:bg-indigo-50',
            attachWrap:   'bg-indigo-50 border-indigo-100',
            attachText:   'text-indigo-700',
            attachMeta:   'text-indigo-400',
            attachIcon:   'text-indigo-500',
            attachClose:  'hover:bg-indigo-200 text-indigo-500',
            msgFileIcon:  'text-indigo-500',
            avatarColors: AVATAR_COLORS.indigo,
        }

    // WS connects on open, flushes completely on close (generation-guarded)
    const { messages, status, isTyping, sendMessage, clearMessages, reconnect } = useChat(isOpen, chatSessionKey)

    // Portal requires document to exist (SSR safe)
    useEffect(() => { setMounted(true) }, [])

    useEffect(() => {
        if (isOpen) return
        setIsTriggerPopping(true)
        const timer = window.setTimeout(() => setIsTriggerPopping(false), 420)
        return () => window.clearTimeout(timer)
    }, [isOpen, pathname])

    const scrollToBottom = useCallback(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }, [])

    useEffect(() => { scrollToBottom() }, [messages, scrollToBottom])
    useEffect(() => { if (isOpen && inputRef.current) inputRef.current.focus() }, [isOpen])

    useEffect(() => {
        if (!isOpen || !isExpanded) return
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault()
                setIsExpanded(false)
            }
        }
        window.addEventListener('keydown', onKeyDown)
        return () => window.removeEventListener('keydown', onKeyDown)
    }, [isOpen, isExpanded])

    useEffect(() => {
        if (!isOpen) {
            setIsExpanded(false)
        }
    }, [isOpen])

    useEffect(() => {
        // Cross-role/account switches in the same browser tab should never
        // carry previous UI state into the next authenticated identity.
        setIsExpanded(false)
        setInputValue('')
        setPendingAttachment(null)
    }, [chatSessionKey])

    const handleSend = useCallback(() => {
        if (!inputValue.trim() && !pendingAttachment) return
        sendMessage(inputValue, pendingAttachment ?? undefined)
        setInputValue('')
        setPendingAttachment(null)
    }, [inputValue, pendingAttachment, sendMessage])

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
    }

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (!file) return
        const MAX_MB = 5
        if (file.size > MAX_MB * 1024 * 1024) {
            alert(`File too large. Max ${MAX_MB} MB.`)
            e.target.value = ''
            return
        }
        const arrayBuffer = await file.arrayBuffer()
        // Chunked loop — avoids "Maximum call stack size exceeded" caused by
        // spreading large Uint8Arrays into String.fromCharCode() as arguments.
        const bytes = new Uint8Array(arrayBuffer)
        let binary = ''
        for (let i = 0; i < bytes.byteLength; i++) {
            binary += String.fromCharCode(bytes[i])
        }
        const base64 = btoa(binary)
        setPendingAttachment({ name: file.name, size: file.size, content: base64, mimeType: file.type })
        e.target.value = ''
    }

    const statusDotClass =
        status === 'connected' ? 'bg-emerald-400' :
        status === 'connecting' ? 'bg-yellow-400 animate-pulse' :
        'bg-red-400'

    const formatText = (text: string) =>
        text
            .replace(/\*\*(.*?)\*\*/g, '<strong class="font-semibold">$1</strong>')
            .replace(/\n/g, '<br/>')
            .replace(/• /g, '<span class="inline-block ml-1">• </span>')

    const quickSuggestions = userRole === 'admin'
        ? ['Fees pending above ₹20,000', 'Fee collection stats', 'List all students', 'Students with overdue fees', 'What can you do?']
        : ['How can you help?', 'Homework help', 'My timetable', 'Leaderboard', 'What can you do?']

    const canSend = !!(inputValue.trim() || pendingAttachment)

    // ── UI ──────────────────────────────────────────────────────────────────
    const ui = (
        <>
            {/* ─── Floating Trigger Button ─── */}
            {!isOpen && (
                <button
                    onClick={() => setIsOpen(true)}
                    className={`
                        fixed bottom-8 right-4 md:right-8 z-[9999]
                        h-11 w-11 rounded-full
                        bg-gradient-to-br ${theme.triggerGrad}
                        flex items-center justify-center
                        ${theme.triggerShadow}
                        hover:scale-110 active:scale-95
                        border border-white/20
                        ${isTriggerPopping ? 'animate-adam-trigger-pop' : ''}
                    `}
                    style={{ transition: 'transform 0.25s ease-in-out, box-shadow 0.25s ease-in-out, opacity 0.25s ease-in-out' }}
                    aria-label="Ask Adam"
                >
                    <div className={`h-8 w-8 rounded-full ${theme.iconBg} flex items-center justify-center`}>
                        <BotAvatar size={22} colors={theme.avatarColors} />
                    </div>
                    <div className={`absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full border-2 ${theme.statusBorder} ${statusDotClass}`} />
                </button>
            )}

            {/* ─── Backdrop ─── */}
            {isOpen && !isExpanded && (
                <div
                    className="fixed inset-0 z-[9997] bg-black/30 backdrop-blur-[2px]"
                    onClick={() => setIsOpen(false)}
                />
            )}

            {/* ─── Full-height Chat Sidebar ─── */}
            <div
                className={`
                    fixed top-0 right-0 z-[9998] h-screen
                    flex flex-col bg-card
                    shadow-[-12px_0_50px_-8px_rgba(0,0,0,0.15),_-2px_0_8px_-2px_rgba(79,70,229,0.1)]
                    transition-transform [transition-duration:380ms]
                    ${isExpanded ? 'w-screen' : 'w-full sm:w-[440px]'}
                    ${isOpen ? 'translate-x-0' : 'translate-x-full'}
                `}
                style={{ transitionTimingFunction: 'cubic-bezier(0.32, 0.72, 0, 1)' }}
            >
                {/* Header */}
                <div className={`relative flex items-center justify-between px-5 py-3.5 bg-gradient-to-r ${theme.headerGrad} text-white flex-shrink-0 overflow-hidden`}>
                    <div className="absolute inset-0 opacity-25" style={{
                        backgroundImage: `radial-gradient(at 0% 0%, rgba(255,255,255,0.4) 0, transparent 50%),
                                          radial-gradient(at 100% 0%, rgba(255,255,255,0.3) 0, transparent 50%)`
                    }} />
                    <div className="flex items-center gap-3 relative z-10">
                        <div className="relative">
                            <div className="w-9 h-9 rounded-xl bg-white/20 backdrop-blur-sm flex items-center justify-center ring-1 ring-white/20">
                                <BotAvatar size={24} colors={theme.avatarColors} />
                            </div>
                            <span className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-[2px] ${theme.statusBorder} ${statusDotClass}`} />
                        </div>
                        <div>
                            <h3 className="font-bold text-[15px] leading-none">Adam</h3>
                            <p className="text-white/60 text-[11px] mt-0.5 flex items-center gap-1">
                                <Sparkles className="w-3 h-3 text-white/60" />
                                AI Assistant · {status === 'connected' ? 'Online' : status === 'connecting' ? 'Connecting…' : 'Offline'}
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-1 relative z-10">
                        {(status === 'disconnected' || status === 'error') && (
                            <button onClick={reconnect} title="Reconnect" className="w-8 h-8 rounded-lg bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors">
                                <WifiOff className="w-3.5 h-3.5" />
                            </button>
                        )}
                        <button
                            onClick={() => setIsExpanded((prev) => !prev)}
                            title={isExpanded ? 'Exit full screen chat' : 'Full screen chat'}
                            aria-label={isExpanded ? 'Exit full screen chat' : 'Full screen chat'}
                            className="w-8 h-8 rounded-lg bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors"
                        >
                            {isExpanded ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
                        </button>
                        <button onClick={clearMessages} title="New chat" className="w-8 h-8 rounded-lg bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors">
                            <RotateCcw className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => setIsOpen(false)} aria-label="Close" className="w-8 h-8 rounded-lg bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors">
                            <X className="w-3.5 h-3.5" />
                        </button>
                    </div>
                </div>

                {/* Messages */}
                <div className={`flex-1 overflow-y-auto py-5 bg-background custom-scrollbar ${isExpanded ? 'px-5 sm:px-7 md:px-10' : 'px-4'}`}>
                    <div className={`space-y-4 ${isExpanded ? 'mx-auto w-full max-w-4xl' : ''}`}>
                    {messages.map((msg) => (
                        <div
                            key={msg.id}
                            className={`flex items-end gap-2.5 ${msg.sender === 'user' ? 'flex-row-reverse' : 'flex-row'}`}
                            style={{ animation: msg.id.startsWith('local-welcome') ? undefined : 'slideUp 0.3s ease-out' }}
                        >
                            {(msg.sender === 'adam' || msg.sender === 'error') && (
                                <div className="w-7 h-7 rounded-lg bg-card flex items-center justify-center flex-shrink-0 shadow-sm border border-border">
                                    <BotAvatar size={18} colors={theme.avatarColors} />
                                </div>
                            )}
                            <div className={`
                                ${msg.dataPayload ? 'max-w-[95%]' : 'max-w-[80%]'} px-4 py-2.5 text-[13px] leading-relaxed
                                ${msg.id.startsWith('local-welcome') ? 'adam-welcome' : ''}
                                ${msg.sender === 'user'
                                    ? `${theme.userBubble} text-white rounded-2xl rounded-tr-sm shadow-md`
                                    : msg.sender === 'error'
                                    ? 'bg-red-50 text-red-600 rounded-2xl rounded-tl-sm border border-red-100'
                                    : 'bg-card text-foreground rounded-2xl rounded-tl-sm border border-border/70 shadow-sm'
                                }
                            `}>
                                {msg.attachment && (
                                    <div className={`flex items-center gap-2 mb-2 px-2 py-1.5 rounded-lg text-[11px] font-medium ${msg.sender === 'user' ? 'bg-white/15' : 'bg-muted border border-border'}`}>
                                        <FileText className={`w-3.5 h-3.5 flex-shrink-0 ${msg.sender === 'user' ? 'text-white/80' : theme.msgFileIcon}`} />
                                        <span className={`truncate max-w-[160px] ${msg.sender === 'user' ? 'text-white/90' : 'text-foreground/80'}`}>{msg.attachment.name}</span>
                                        <span className={`flex-shrink-0 ${msg.sender === 'user' ? 'text-white/50' : 'text-muted-foreground'}`}>{(msg.attachment.size / 1024).toFixed(1)} KB</span>
                                    </div>
                                )}
                                {msg.dataPayload && msg.sender === 'adam' && (
                                    <DataResultRenderer payload={msg.dataPayload} />
                                )}
                                {msg.text && (
                                    <div dangerouslySetInnerHTML={{ __html: formatText(msg.text) }} />
                                )}
                                <p className={`text-[10px] mt-1.5 ${msg.sender === 'user' ? 'text-white/50' : msg.sender === 'error' ? 'text-red-400' : 'text-slate-400'}`}>
                                    {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                </p>
                            </div>
                        </div>
                    ))}

                    {isTyping && (
                        <div className="flex items-end gap-2.5">
                            <div className="w-7 h-7 rounded-lg bg-card flex items-center justify-center flex-shrink-0 shadow-sm border border-border">
                                <BotAvatar size={18} colors={theme.avatarColors} />
                            </div>
                            <div className="bg-card px-4 py-3 rounded-2xl rounded-tl-sm border border-border/70 shadow-sm">
                                <div className="flex gap-1.5 items-center">
                                    <span className={`w-1.5 h-1.5 ${theme.typingDot} rounded-full animate-bounce`} style={{ animationDelay: '0ms' }} />
                                    <span className={`w-1.5 h-1.5 ${theme.typingDot} rounded-full animate-bounce`} style={{ animationDelay: '150ms' }} />
                                    <span className={`w-1.5 h-1.5 ${theme.typingDot} rounded-full animate-bounce`} style={{ animationDelay: '300ms' }} />
                                </div>
                            </div>
                        </div>
                    )}
                    <div ref={messagesEndRef} />
                    </div>
                </div>

                {/* Quick Suggestions */}
                {messages.length <= 1 && (
                    <div className={`pb-3 pt-2 border-t border-border bg-card flex-shrink-0 ${isExpanded ? 'px-5 sm:px-7 md:px-10' : 'px-4'}`}>
                        <div className={isExpanded ? 'mx-auto flex w-full max-w-[48rem] flex-wrap gap-2' : 'flex flex-wrap gap-1.5'}>
                            {quickSuggestions.map((s) => (
                                <button
                                    key={s}
                                    onClick={() => sendMessage(s)}
                                    className={`${isExpanded ? 'px-4 py-2.5 text-sm rounded-2xl text-left' : 'px-3 py-1.5 text-[11px] rounded-full'} font-medium border transition-colors ${theme.chipColors}`}
                                >
                                    {s}
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                {/* Attachment preview */}
                {pendingAttachment && (
                    <div className={`pt-2 pb-0 bg-card flex-shrink-0 ${isExpanded ? 'px-5 sm:px-7 md:px-10' : 'px-4'}`}>
                        <div className={`${isExpanded ? 'mx-auto w-full max-w-[48rem]' : ''}`}>
                        <div className={`flex items-center gap-2 px-3 py-2 rounded-xl border ${theme.attachWrap}`}>
                            <FileText className={`w-4 h-4 flex-shrink-0 ${theme.attachIcon}`} />
                            <span className={`text-[12px] font-medium truncate flex-1 ${theme.attachText}`}>{pendingAttachment.name}</span>
                            <span className={`text-[11px] flex-shrink-0 ${theme.attachMeta}`}>{(pendingAttachment.size / 1024).toFixed(1)} KB</span>
                            <button onClick={() => setPendingAttachment(null)} className={`w-5 h-5 flex items-center justify-center rounded-full transition-colors flex-shrink-0 ${theme.attachClose}`}>
                                <X className="w-3 h-3" />
                            </button>
                        </div>
                        </div>
                    </div>
                )}

                {/* Input */}
                <div className={`py-3 border-t border-border bg-card flex-shrink-0 ${isExpanded ? 'px-5 sm:px-7 md:px-10' : 'px-4'}`}>
                    <div className={`${isExpanded ? 'mx-auto w-full max-w-[48rem]' : ''}`}>
                    <div className={`flex items-center gap-2 rounded-[30px] px-3 py-2.5 border border-white/10 bg-[#2f2f2f] transition-all duration-200 ${theme.focusRing}`}>
                        {/* Hidden file input */}
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept=".pdf,.doc,.docx,.txt,.md,.csv,.xlsx,.pptx"
                            onChange={handleFileChange}
                            className="hidden"
                        />
                        <button
                            onClick={() => fileInputRef.current?.click()}
                            title="Attach document"
                            className="w-9 h-9 rounded-full flex items-center justify-center text-white/85 transition-colors flex-shrink-0 hover:bg-white/10"
                        >
                            <Plus className="w-4 h-4" />
                        </button>
                        <input
                            ref={inputRef}
                            type="text"
                            value={inputValue}
                            onChange={(e) => setInputValue(e.target.value)}
                            onKeyDown={handleKeyDown}
                            placeholder={pendingAttachment ? 'Add a message or just send the doc…' : 'Message Adam…'}
                            className="flex-1 bg-transparent text-[14px] text-white placeholder:text-white/55 outline-none focus:outline-none focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0"
                        />
                        <button
                            onClick={handleSend}
                            disabled={!canSend}
                            className={`
                                w-9 h-9 rounded-full flex items-center justify-center transition-all duration-200 flex-shrink-0
                                ${canSend
                                    ? 'bg-white text-black shadow hover:bg-white/90 hover:scale-105'
                                    : 'bg-white/20 text-white/35 cursor-not-allowed'
                                }
                            `}
                        >
                            <ArrowUp className="w-4 h-4" />
                        </button>
                    </div>
                    </div>
                    <p className="text-center text-[11px] text-muted-foreground mt-1.5 select-none leading-tight">
                        Adam can make mistakes. Check important info.
                    </p>
                </div>
            </div>

            {/* Animations */}
            <style dangerouslySetInnerHTML={{ __html: `
                @keyframes shimmer { 100% { transform: translateX(200%); } }
                .animate-shimmer { animation: shimmer 2s infinite; }
                @keyframes slideUp { from { opacity:0; transform:translateY(12px); } to { opacity:1; transform:translateY(0); } }
                @keyframes welcomePop {
                    0%   { opacity:0; transform: translateY(18px) scale(0.95); }
                    60%  { opacity:1; transform: translateY(-3px) scale(1.01); }
                    100% { opacity:1; transform: translateY(0)   scale(1);    }
                }
                @keyframes adamTriggerPop {
                    0%   { opacity: 0; transform: translateY(18px) scale(0.88); }
                    65%  { opacity: 1; transform: translateY(-4px) scale(1.03); }
                    100% { opacity: 1; transform: translateY(0) scale(1); }
                }
                .animate-adam-trigger-pop {
                    animation: adamTriggerPop 0.42s cubic-bezier(0.22, 1, 0.36, 1) both;
                }
                .adam-welcome {
                    animation: welcomePop 0.55s cubic-bezier(0.34,1.56,0.64,1) both;
                }
                .adam-welcome .welcome-sparkle {
                    display: inline-block;
                    animation: shimmer-text 2.5s ease-in-out infinite;
                }
                @keyframes shimmer-text {
                    0%,100% { opacity: 1; }
                    50%     { opacity: 0.6; }
                }
                .custom-scrollbar::-webkit-scrollbar { width: 4px; }
                .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
                .custom-scrollbar::-webkit-scrollbar-thumb { background: hsl(var(--border)); border-radius: 8px; }
                .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: hsl(var(--muted-foreground) / 0.4); }
            ` }} />
        </>
    )

    // Render into document.body via portal so fixed positioning is always
    // relative to the true viewport, not clipped by any overflow:hidden parent.
    if (!mounted) return null
    return createPortal(ui, document.body)
}
