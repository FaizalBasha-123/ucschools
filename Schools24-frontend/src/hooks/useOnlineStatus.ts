import { useEffect, useState } from 'react'

/**
 * Tracks browser online/offline status.
 *
 * Uses navigator.onLine as the initial value, then listens to the `online`
 * and `offline` window events. React Query handles retrying failed requests
 * automatically when this turns true again — this hook is for UI feedback only.
 */
export function useOnlineStatus(): boolean {
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  )

  useEffect(() => {
    const handleOnline  = () => setIsOnline(true)
    const handleOffline = () => setIsOnline(false)

    // Browser events (slow — OS-level detection)
    window.addEventListener('online',  handleOnline)
    window.addEventListener('offline', handleOffline)
    // Fast-path: fired by api.ts the moment a fetch() rejects with TypeError
    window.addEventListener('app:offline', handleOffline)
    return () => {
      window.removeEventListener('online',  handleOnline)
      window.removeEventListener('offline', handleOffline)
      window.removeEventListener('app:offline', handleOffline)
    }
  }, [])

  return isOnline
}
