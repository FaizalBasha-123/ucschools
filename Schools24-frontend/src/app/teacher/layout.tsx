"use client"

import { ReactNode, useRef } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { Sidebar } from '@/components/layout/Sidebar'
import { HeaderShell } from '@/components/layout/Header'
import { Loader2 } from 'lucide-react'
import AdamChatbot from '@/components/chatbot/AdamChatbot'
import { BackToTopButton } from '@/components/layout/BackToTopButton'
import { useAutoHideHeader } from '@/hooks/useAutoHideHeader'

export default function TeacherLayout({ children }: { children: ReactNode }) {
    const { isLoading, isAuthenticated } = useAuth()
    const mainRef = useRef<HTMLElement>(null)
    const isHeaderVisible = useAutoHideHeader(mainRef)

    if (isLoading) {
        return (
            <div className="min-h-[100dvh] flex items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
        )
    }

    if (!isAuthenticated) {
        return null
    }

    return (
        <div className="flex h-[100dvh] bg-background">
            <Sidebar />
            <div className="relative flex flex-col flex-1 overflow-hidden">
                <HeaderShell hidden={!isHeaderVisible} />
                <main ref={mainRef} className="app-scroll flex-1 overflow-auto px-2 py-3 pt-20 sm:px-3 sm:py-4 sm:pt-20 md:px-4 md:py-6 md:pt-24">
                    <div className="mx-auto w-full max-w-[1600px]">
                        {children}
                    </div>
                </main>
            </div>
            <BackToTopButton scrollRef={mainRef} />
            <AdamChatbot />
        </div>
    )
}
