"use client"

import { ReactNode, useEffect, useRef } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { Sidebar } from '@/components/layout/Sidebar'
import { HeaderShell } from '@/components/layout/Header'
import { Loader2 } from 'lucide-react'
import { BackToTopButton } from '@/components/layout/BackToTopButton'
import { useAutoHideHeader } from '@/hooks/useAutoHideHeader'

export default function SuperAdminLayout({ children }: { children: ReactNode }) {
    const { isLoading, isAuthenticated, user } = useAuth()
    const router = useRouter()
    const pathname = usePathname()
    const mainRef = useRef<HTMLElement>(null)
    const isHeaderVisible = useAutoHideHeader(mainRef)
    const isSchoolConsoleRoute = pathname?.startsWith('/super-admin/school/')

    useEffect(() => {
        if (isLoading || !user || user.role === 'super_admin') return

        const fallbackPath =
            user.role === 'admin'
                ? '/admin/dashboard'
                : user.role === 'teacher'
                    ? '/teacher/dashboard'
                    : user.role === 'student'
                        ? '/student/dashboard'
                        : '/login'

        router.push(fallbackPath)
    }, [isLoading, router, user])

    if (isLoading) {
        return (
            <div className="min-h-[100dvh] flex items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
        )
    }

    if (!isAuthenticated || !user || user.role !== 'super_admin') {
        return null
    }

    if (isSchoolConsoleRoute) {
        return <div className="min-h-[100dvh] bg-background">{children}</div>
    }

    return (
        <div className="flex h-[100dvh] bg-background">
            <Sidebar />
            <div className="relative flex flex-col flex-1 overflow-hidden">
                <HeaderShell hidden={!isHeaderVisible} />
                <main
                    ref={mainRef}
                    className="app-scroll flex-1 overflow-y-auto overflow-x-hidden px-1.5 py-3 pt-20 sm:px-3 sm:py-4 sm:pt-20 md:px-4 md:py-6 md:pt-24"
                >
                    <div className="mx-auto w-full max-w-[1600px]">
                        {children}
                    </div>
                </main>
            </div>
            <BackToTopButton scrollRef={mainRef} bottomClassName="bottom-8" />
        </div>
    )
}
