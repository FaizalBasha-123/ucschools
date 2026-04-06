"use client"

import { useEffect } from 'react'
import { initConsoleWelcome } from '@/lib/consoleWelcome'

/**
 * Client component that initializes the developer console welcome message
 * Must be rendered as a client component since it uses browser APIs
 */
export function ConsoleWelcome() {
    useEffect(() => {
        // Only run in development or when explicitly enabled
        // In production, users can still see it but it won't clear existing logs
        initConsoleWelcome()
    }, [])

    // This component renders nothing, it's just for the side effect
    return null
}
