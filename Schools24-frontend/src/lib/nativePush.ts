const PUSH_TOKEN_KEY = 'School24_push_token'
const PUSH_DEVICE_ID_KEY = 'School24_push_device_id'

export function getPushDeviceID(): string {
  if (typeof window === 'undefined') return ''
  let value = localStorage.getItem(PUSH_DEVICE_ID_KEY)
  if (!value) {
    value = window.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`
    localStorage.setItem(PUSH_DEVICE_ID_KEY, value)
  }
  return value
}

export function getStoredPushToken(): string {
  if (typeof window === 'undefined') return ''
  return localStorage.getItem(PUSH_TOKEN_KEY) ?? ''
}

export function setStoredPushToken(token: string) {
  if (typeof window === 'undefined') return
  localStorage.setItem(PUSH_TOKEN_KEY, token)
}

export function clearStoredPushToken() {
  if (typeof window === 'undefined') return
  localStorage.removeItem(PUSH_TOKEN_KEY)
}
