import { Capacitor } from '@capacitor/core'
import { useEffect, useState } from 'react'

/**
 * Returns true when the app is running inside a Capacitor native shell
 * (i.e. the Schools24 Android APK / TV app), false in any regular browser.
 *
 * Use this to:
 *  - Hide back-button UI (native apps use hardware back / gesture)
 *  - Enable native-only features (background GPS, haptics, etc.)
 *  - Adjust layout for smaller-screen phone vs. TV screen
 *
 * Safe to call during SSR — returns false on the server.
 */
function detectNativeApp(): boolean {
  if (typeof window === 'undefined') return false
  if (Capacitor.isNativePlatform()) return true
  return /Schools24App\//i.test(window.navigator.userAgent)
}

export function useIsNativeApp(): boolean {
  const [isNative, setIsNative] = useState(false)

  useEffect(() => {
    setIsNative(detectNativeApp())
  }, [])

  return isNative
}
