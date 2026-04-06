import { CapacitorConfig } from '@capacitor/cli'

const isProd = process.env.NODE_ENV === 'production'
const serverUrl = (() => {
  if (!isProd && process.env.CAPACITOR_SERVER_URL) return process.env.CAPACITOR_SERVER_URL
  // Default to the hosted dashboard so device installs never hit localhost.
  return 'https://dash.myschools.in'
})()

const allowNavigation = [
  serverUrl,
  process.env.NEXT_PUBLIC_FORMS_URL,
]
  .filter(Boolean)
  .map((url) => {
    try {
      return new URL(url as string).hostname
    } catch {
      return null
    }
  })
  .filter((hostname): hostname is string => Boolean(hostname))

const config: CapacitorConfig = {
  appId: 'in.myschools.app',
  appName: 'MySchools',

  // ── Remote URL mode ─────────────────────────────────────────────────────────
  // The APK is a native shell; content is always loaded from the live deployment.
  // This means:
  //  • No static export or `next export` needed — SSR, API routes, middleware all work.
  //  • Content updates deploy instantly (just push frontend — no APK rebuild).
  //  • APK only needs a rebuild when adding/upgrading native plugins.
  //
  // Set CAPACITOR_SERVER_URL env var to override for staging or local dev.
  server: {
    url: serverUrl,
    cleartext: serverUrl.startsWith('http://'),
    // Allow the web page to call the Capacitor JS bridge injected by the native shell.
    allowNavigation,
  },

  // ── Plugins ─────────────────────────────────────────────────────────────────
  plugins: {
    BackgroundGeolocation: {
      // Android: show a persistent notification while the driver is tracking.
      // Required by Android 8+ for foreground services.
      backgroundMessage: 'MySchools is tracking your location for bus route monitoring.',
      backgroundTitle: 'MySchools – Driver Tracking',
      requestPermissions: true,
      stale: false,
      // Update interval in seconds. 5s matches the backend WebSocket heartbeat.
      distanceFilter: 10, // metres — emit event only when moved ≥10 m (battery saver)
    },

    // ── Push Notifications (FCM v1) ──────────────────────────────────────────
    PushNotifications: {
      // Ask for permission as soon as the plugin is first used, rather than
      // waiting for an explicit requestPermissions() call in JS.
      presentationOptions: ['badge', 'sound', 'alert'],
    },
  },

  android: {
    allowMixedContent: false,
    overrideUserAgent: 'MySchoolsApp/1.0 Android',
  },

  // webDir is unused in remote URL mode but required by the CLI schema.
  webDir: 'out',
}

export default config
