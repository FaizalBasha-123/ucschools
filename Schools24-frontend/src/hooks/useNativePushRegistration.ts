'use client'

import { useEffect } from 'react'
import { Capacitor } from '@capacitor/core'
import { api } from '@/lib/api'
import { clearStoredPushToken, getPushDeviceID, getStoredPushToken, setStoredPushToken } from '@/lib/nativePush'
import { toast } from 'sonner'

type AuthUser = {
  id?: string
}

export function useNativePushRegistration(user: AuthUser | null) {
  useEffect(() => {
    if (!Capacitor.isNativePlatform() || !user?.id) return

    let active = true
    let registrationHandle: { remove: () => Promise<void> } | null = null
    let registrationErrorHandle: { remove: () => Promise<void> } | null = null
		let actionHandle: { remove: () => Promise<void> } | null = null
		let receivedHandle: { remove: () => Promise<void> } | null = null

    const setup = async () => {
      try {
        const { PushNotifications } = await import('@capacitor/push-notifications')
        const status = await PushNotifications.checkPermissions()
        if (status.receive !== 'granted') {
          const requested = await PushNotifications.requestPermissions()
          if (requested.receive !== 'granted') return
        }

        registrationHandle = await PushNotifications.addListener('registration', async (token) => {
          if (!active) return
          const nextToken = token.value?.trim()
          if (!nextToken) return

          const previousToken = getStoredPushToken()
          if (previousToken && previousToken !== nextToken) {
            try {
              await api.delete(`/auth/push-tokens?token=${encodeURIComponent(previousToken)}`)
            } catch {
              // best effort cleanup
            }
          }

          await api.post('/auth/push-tokens', {
            token: nextToken,
            platform: Capacitor.getPlatform() === 'android' ? 'android' : 'ios',
            device_id: getPushDeviceID(),
            device_name: window.navigator.userAgent,
            app_version: '1.0.0',
          })
          setStoredPushToken(nextToken)
        })

        registrationErrorHandle = await PushNotifications.addListener('registrationError', () => {
          clearStoredPushToken()
        })

      receivedHandle = await PushNotifications.addListener('pushNotificationReceived', (notification) => {
        const title = notification.title?.trim() || 'Schools24'
        const body = notification.body?.trim() || 'You have a new notification.'
        const data = notification.data ?? {}
        const deeplink = typeof data.deeplink === 'string' ? data.deeplink.trim() : ''
        const kind = typeof data.kind === 'string' ? data.kind.trim() : ''
        toast(title, { description: body })
        if (kind.startsWith('transport_')) {
          window.dispatchEvent(new CustomEvent('schools24:transport-session', { detail: data }))
        }
        if (kind === 'transport_driver_start' && deeplink.startsWith('/')) {
          window.location.assign(deeplink)
        }
      })

      actionHandle = await PushNotifications.addListener('pushNotificationActionPerformed', (event) => {
        const data = event.notification?.data ?? {}
        const deeplink = typeof data.deeplink === 'string' ? data.deeplink.trim() : ''
        const kind = typeof data.kind === 'string' ? data.kind.trim() : ''
        if (kind.startsWith('transport_')) {
          window.dispatchEvent(new CustomEvent('schools24:transport-session', { detail: data }))
        }
        if (deeplink.startsWith('/')) {
          window.location.assign(deeplink)
        }
      })

        await PushNotifications.register()
      } catch {
        // native push not configured in this build
      }
    }

    void setup()

    return () => {
      active = false
      void registrationHandle?.remove()
      void registrationErrorHandle?.remove()
			void receivedHandle?.remove()
			void actionHandle?.remove()
    }
  }, [user?.id])
}
