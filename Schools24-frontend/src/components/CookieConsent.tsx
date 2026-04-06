"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { X } from "lucide-react"
import Link from "next/link"

interface CookiePreferences {
  essential: boolean // always true — the only category in use
  acceptedAt: string
  policyVersion: string
}

const POLICY_VERSION = "2026-03-18"

const DEFAULT_PREFERENCES: CookiePreferences = {
  essential: true,
  acceptedAt: new Date().toISOString(),
  policyVersion: POLICY_VERSION,
}

const STORAGE_KEY = "schools24_cookie_preferences"

export function CookieConsentBanner() {
  const [showBanner, setShowBanner] = useState(false)
  const [mounted, setMounted] = useState(false)

  // Load preferences from localStorage on mount
  useEffect(() => {
    setMounted(true)
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
      try {
        const parsed = JSON.parse(stored)
        // Show banner again if policy version changed (re-consent)
        if (parsed.policyVersion !== POLICY_VERSION) {
          setShowBanner(true)
        } else {
          setShowBanner(false)
        }
      } catch {
        setShowBanner(true)
      }
    } else {
      setShowBanner(true)
    }
  }, [])

  if (!mounted) return null

  const handleAccept = () => {
    const prefs: CookiePreferences = {
      essential: true,
      acceptedAt: new Date().toISOString(),
      policyVersion: POLICY_VERSION,
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs))
    // Dispatch event so other components can react to preference changes
    window.dispatchEvent(
      new CustomEvent("cookiePreferencesChanged", { detail: prefs })
    )
    setShowBanner(false)
  }

  if (!showBanner) return null

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-slate-200 shadow-lg">
      <div className="max-w-6xl mx-auto px-4 py-4 sm:px-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex-1">
            <h3 className="font-semibold text-slate-900 mb-1">Essential Cookies Only</h3>
            <p className="text-sm text-slate-600 mb-3 sm:mb-0">
              Schools24 uses only <strong>3 essential cookies</strong> for login, session management, and CSRF protection.
              We do not use analytics, marketing, or tracking cookies on this application.
            </p>
          </div>

          <div className="flex gap-2 items-center">
            <Button
              size="sm"
              onClick={handleAccept}
              className="text-xs bg-blue-600 hover:bg-blue-700"
            >
              Got It
            </Button>
            <button
              onClick={() => setShowBanner(false)}
              className="text-slate-500 hover:text-slate-700"
              aria-label="Close cookie banner"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        <div className="mt-3 flex gap-4 text-xs text-slate-600">
          <Link href="/cookie-policy" className="text-blue-600 hover:underline">
            Cookie Policy
          </Link>
          <Link href="/privacy-policy" className="text-blue-600 hover:underline">
            Privacy Policy
          </Link>
        </div>
      </div>
    </div>
  )
}

/**
 * Hook to get current cookie preferences
 * Use this in components that need to check user consent status.
 * Currently the app only uses essential cookies, so this always returns
 * essential: true. The hook is retained for forward-compatibility if
 * consent-gated analytics are added later (follow landing site pattern).
 */
export function useCookiePreferences() {
  const [preferences, setPreferences] = useState<CookiePreferences>(DEFAULT_PREFERENCES)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
      try {
        setPreferences(JSON.parse(stored))
      } catch {
        setPreferences(DEFAULT_PREFERENCES)
      }
    }

    // Listen for changes from banner
    const handleChange = (event: Event) => {
      if (event instanceof CustomEvent) {
        setPreferences(event.detail)
      }
    }

    window.addEventListener("cookiePreferencesChanged", handleChange)
    return () => window.removeEventListener("cookiePreferencesChanged", handleChange)
  }, [])

  if (!mounted) {
    return DEFAULT_PREFERENCES
  }

  return preferences
}
