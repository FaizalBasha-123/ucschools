"use client"

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { Capacitor } from '@capacitor/core'
import { UserRole } from '@/types'
import { api } from '@/lib/api'
import { clearStoredPushToken, getPushDeviceID, getStoredPushToken } from '@/lib/nativePush'
import { startNativeDriverTrackingService, stopNativeDriverTrackingService } from '@/lib/nativeDriverTracking'

interface User {
    id: string
    name: string
    full_name?: string
    email: string
    role: UserRole
    avatar?: string
    phone?: string
    profile_picture_url?: string
    school_id?: string
    school_name?: string
    login_count?: number
    created_by?: string
}

const getDashboardPath = (role: UserRole): string => {
    switch (role) {
        case 'super_admin': return '/super-admin';
        case 'admin': return '/admin/dashboard';
        case 'teacher': return '/teacher/dashboard';
        case 'student': return '/student/dashboard';
        case 'staff': return '/driver/tracking';
        default: return '/login';
    }
};

interface AuthContextType {
    user: User | null
    isAuthenticated: boolean
    isLoading: boolean
    login: (email: string, password: string, rememberMe?: boolean) => Promise<User>
    logout: () => void
    userRole: UserRole | null
    /** Merge partial updates into the logged-in user and persist to storage */
    updateUser: (partial: Partial<User>) => void
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

const STORAGE_KEYS = {
    USER: 'School24_user',
    TOKEN: 'School24_token',
    REFRESH_TOKEN: 'School24_refresh_token',
    EXPIRY: 'School24_token_expiry',
    REMEMBER: 'School24_remember',
    LAST_ROLE: 'School24_last_role'
} as const

export const PASSWORD_SETUP_LOGIN_MARKER = 'School24_password_setup_login_marker'

const decodeJwtPayload = (token: string): Record<string, any> | null => {
    try {
        const payloadPart = token.split('.')[1]
        if (!payloadPart) return null
        const base64 = payloadPart.replace(/-/g, '+').replace(/_/g, '/')
        const json = atob(base64)
        return JSON.parse(json)
    } catch {
        return null
    }
}

const getStorage = (): Storage => {
    if (typeof window === 'undefined') return localStorage
    return localStorage
}

const toLoginRole = (role: UserRole): 'admin' | 'teacher' | 'student' | 'staff' => {
    if (role === 'super_admin' || role === 'admin') return 'admin'
    if (role === 'teacher') return 'teacher'
    if (role === 'staff') return 'staff'
    return 'student'
}

const setLastRoleMemory = (role: UserRole) => {
    [localStorage, sessionStorage].forEach(storage => {
        storage.setItem(STORAGE_KEYS.LAST_ROLE, toLoginRole(role))
    })
    if (typeof document !== 'undefined') {
        document.cookie = `School24_last_role=${encodeURIComponent(role)}; path=/; max-age=31536000; SameSite=Lax`
    }
}

const clearAuthData = () => {
    [localStorage, sessionStorage].forEach(storage => {
        Object.values(STORAGE_KEYS).forEach(key => {
            if (key === STORAGE_KEYS.LAST_ROLE) return
            storage.removeItem(key)
        })
    })
    // Clear frontend session cookies used only for middleware routing.
    if (typeof document !== 'undefined') {
        document.cookie = 'School24_session=; path=/; max-age=0; SameSite=Lax'
        document.cookie = 'School24_role=; path=/; max-age=0; SameSite=Lax'
    }
}

const isValidRole = (role: unknown): role is UserRole => {
    return role === 'super_admin' || role === 'admin' || role === 'teacher' || role === 'student' || role === 'staff' || role === 'parent'
}

const getStoredValue = (key: string): string | null => {
    if (typeof window === 'undefined') return null
    const primary = getStorage()
    return (
        primary.getItem(key) ||
        localStorage.getItem(key) ||
        sessionStorage.getItem(key)
    )
}

const getActiveToken = (): string | null => {
    // Keep token fallback available even on cookie-session hosts.
    // Some browser/proxy setups may not persist auth cookies reliably.
    return getStoredValue(STORAGE_KEYS.TOKEN)
}

const rehydrateUserFromSources = (): User | null => {
    const storedUser = getStoredValue(STORAGE_KEYS.USER)
    const token = getActiveToken()

    if (storedUser) {
        try {
            return JSON.parse(storedUser) as User
        } catch {
            // continue to JWT fallback
        }
    }

    if (!token) return null

    const payload = decodeJwtPayload(token)
    if (!payload || !isValidRole(payload.role)) return null

    const email = (payload.email as string) || ''
    const fallbackName = (email && email.includes('@')) ? email.split('@')[0] : 'User'

    return {
        id: (payload.user_id as string) || (payload.sub as string) || '',
        name: (payload.full_name as string) || (payload.name as string) || fallbackName,
        full_name: (payload.full_name as string) || (payload.name as string) || fallbackName,
        email,
        role: payload.role as UserRole,
        school_id: payload.school_id as string | undefined,
    }
}

export function AuthProvider({ children }: { children: ReactNode }) {
    const [user, setUser] = useState<User | null>(null)
    const [isLoading, setIsLoading] = useState(true)
    const router = useRouter()
    const pathname = usePathname()

    useEffect(() => {
        const activeToken = getActiveToken()
        const hydratedUser = rehydrateUserFromSources()

        if (!hydratedUser) {
            // Clear stale routing cookies so middleware doesn't redirect the
            // user back to a protected page after AuthContext pushes to /login.
            // Without this, a stale School24_session cookie causes an infinite
            // middleware ↔ router redirect loop producing a blank screen.
            clearAuthData()
            setUser(null)
            setIsLoading(false)
            return
        }

        setUser(hydratedUser)
        setLastRoleMemory(hydratedUser.role)

        const storage = getStorage()
        if (!storage.getItem(STORAGE_KEYS.USER)) {
            storage.setItem(STORAGE_KEYS.USER, JSON.stringify(hydratedUser))
        }
        if (activeToken && !storage.getItem(STORAGE_KEYS.TOKEN)) {
            storage.setItem(STORAGE_KEYS.TOKEN, activeToken)
        }
        // Restore routing cookies with the remaining max-age so they survive
        // browser restarts (without this they become session cookies on every
        // rehydration, causing a redirect-to-login bounce on the next browser open).
        const maxAgeAttr = '; max-age=31536000'
        document.cookie = `School24_session=1; path=/; SameSite=Lax${maxAgeAttr}`
        document.cookie = `School24_role=${encodeURIComponent(hydratedUser.role)}; path=/; SameSite=Lax${maxAgeAttr}`

        if ((Capacitor.isNativePlatform() || /Schools24App\//i.test(window.navigator.userAgent)) && hydratedUser.role === 'staff' && activeToken) {
            startNativeDriverTrackingService(activeToken, getStoredValue(STORAGE_KEYS.REFRESH_TOKEN) || undefined).catch(() => null)
        }

        setIsLoading(false)
    }, [])

    useEffect(() => {
        const handleStorage = (event: StorageEvent) => {
            if (!event.key) return
            if (
                event.key === STORAGE_KEYS.TOKEN ||
                event.key === STORAGE_KEYS.USER ||
                event.key === STORAGE_KEYS.REMEMBER ||
                event.key === STORAGE_KEYS.EXPIRY
            ) {
                const hydratedUser = rehydrateUserFromSources()
                setUser(hydratedUser)
            }
        }

        window.addEventListener('storage', handleStorage)
        return () => window.removeEventListener('storage', handleStorage)
    }, [])

    useEffect(() => {
        const handleAuthExpired = () => {
            // Intentionally do not force logout; user remains signed in until explicit logout.
        }

        window.addEventListener('app:auth-expired', handleAuthExpired as EventListener)
        return () => window.removeEventListener('app:auth-expired', handleAuthExpired as EventListener)
    }, [pathname, router])

    useEffect(() => {
        if (isLoading) return;

        if (user && pathname === '/login') {
            router.push(getDashboardPath(user.role));
            return;
        }

        if (!user) {
            const protectedPaths = ['/admin', '/teacher', '/student', '/super-admin', '/driver']
            const isProtected = protectedPaths.some(path => pathname === path || pathname.startsWith(`${path}/`))
            if (isProtected) {
                router.push('/login')
            }
            return;
        }

        const pathSegments = pathname.split('/').filter(Boolean);
        const baseSegment = pathSegments[0];

        const roleAllowedMap: Record<string, UserRole[]> = {
            'admin': ['admin', 'super_admin'],
            'teacher': ['teacher', 'admin', 'super_admin'],
            'student': ['student', 'admin', 'super_admin'],
            'super-admin': ['super_admin'],
            'driver': ['staff']
        };

        if (roleAllowedMap[baseSegment] && !roleAllowedMap[baseSegment].includes(user.role)) {
            router.push(getDashboardPath(user.role));
        }
    }, [isLoading, user, pathname, router])

    const login = async (email: string, password: string, rememberMe: boolean = false): Promise<User> => {
        setIsLoading(true);
        try {
            const response = await api.post<{ access_token: string, refresh_token?: string, user: any, expires_in: number }>('/auth/login', {
                email,
                password,
                remember_me: rememberMe,
            });

            if (!isValidRole(response.user?.role)) {
                throw new Error('Invalid user role returned by server')
            }

            const userData: User = {
                ...response.user,
                role: response.user.role,
                name: response.user.full_name || response.user.name || 'User'
            };

            const expiryTimestamp = Date.now() + (response.expires_in * 1000)
            clearAuthData()
            localStorage.setItem(STORAGE_KEYS.REMEMBER, rememberMe ? 'true' : 'false')

            const storage = localStorage
            storage.setItem(STORAGE_KEYS.USER, JSON.stringify(userData))
            storage.setItem(STORAGE_KEYS.EXPIRY, expiryTimestamp.toString())
            // Always persist access token as a fallback for API auth.
            storage.setItem(STORAGE_KEYS.TOKEN, response.access_token)
            if (response.refresh_token) {
                storage.setItem(STORAGE_KEYS.REFRESH_TOKEN, response.refresh_token)
            }
            sessionStorage.setItem(PASSWORD_SETUP_LOGIN_MARKER, JSON.stringify({
                user_id: userData.id,
                login_count: userData.login_count ?? null,
            }))

            // Set lightweight routing cookies for Next.js middleware.
            // The primary API auth session is carried by backend HttpOnly cookies when available.
            const maxAge = 31536000
            document.cookie = `School24_session=1; path=/; max-age=${maxAge}; SameSite=Lax`
            document.cookie = `School24_role=${encodeURIComponent(userData.role)}; path=/; max-age=${maxAge}; SameSite=Lax`
            setLastRoleMemory(userData.role)

            if ((Capacitor.isNativePlatform() || /Schools24App\//i.test(window.navigator.userAgent)) && userData.role === 'staff') {
                startNativeDriverTrackingService(response.access_token, response.refresh_token).catch(() => null)
            }

            setUser(userData);
            return userData;
        } finally {
            setIsLoading(false);
        }
    }

    const logout = () => {
        setUser(null)
        if (Capacitor.isNativePlatform()) {
            stopNativeDriverTrackingService().catch(() => null)
            const deviceID = getPushDeviceID()
            const pushToken = getStoredPushToken()
            if (pushToken || deviceID) {
                api.delete(`/auth/push-tokens?${new URLSearchParams(
                    pushToken ? { token: pushToken, device_id: deviceID } : { device_id: deviceID }
                ).toString()}`).catch(() => null)
            }
            clearStoredPushToken()
        }
        api.post('/auth/logout', {}).catch(() => null)
        clearAuthData()
        if (typeof window !== 'undefined' && (Capacitor.isNativePlatform() || /Schools24App\//i.test(window.navigator.userAgent))) {
            // Force a hard navigation in native WebView to avoid stale protected-route
            // trees that can render a long white screen after sign-out.
            window.location.replace('/login')
            return
        }
        router.replace('/login')
    }

    const updateUser = (partial: Partial<User>) => {
        setUser(prev => {
            if (!prev) return prev
            const updated = { ...prev, ...partial }
            // Persist so subsequent page loads see the refreshed data
            const storage = getStorage()
            storage.setItem(STORAGE_KEYS.USER, JSON.stringify(updated))
            if (updated.role && updated.role !== prev.role) {
                setLastRoleMemory(updated.role)
            }
            return updated
        })
    }

    return (
        <AuthContext.Provider
            value={{
                user,
                isAuthenticated: !!user,
                isLoading,
                login,
                logout,
                userRole: user?.role || null,
                updateUser,
            }}
        >
            {children}
        </AuthContext.Provider>
    )
}

export function useAuth() {
    const context = useContext(AuthContext)
    if (context === undefined) {
        throw new Error('useAuth must be used within an AuthProvider')
    }
    return context
}
