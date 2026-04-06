"use client"

import { useEffect } from "react"

/**
 * Suppresses a known Next.js 16 devtools bug where the draggable dev-overlay
 * calls `releasePointerCapture` after the pointer ID has already expired.
 *
 * Root cause: `next/dist/next-devtools/draggable.tsx` calls
 * `element.releasePointerCapture(pointerId)` inside a pointerup/pointermove
 * handler but the browser already dropped the active pointer (e.g. fast click
 * or the element lost focus). This throws a `NotFoundError` that is harmless
 * (the drag already ended) but pollutes the console in development.
 *
 * Fix: intercept both the global `error` event and the original
 * `releasePointerCapture` method to silently swallow this specific case.
 * This component renders nothing and is excluded from production bundles.
 *
 * Remove this component once Next.js ships a patch for the devtools bug.
 */
// Extension URL scheme prefixes — errors from these origins are never our app's fault.
const EXTENSION_ORIGINS = [
  "chrome-extension://",
  "moz-extension://",
  "safari-extension://",
  "safari-web-extension://",
  "ms-browser-extension://",
]

function isExtensionError(event: ErrorEvent): boolean {
  const src = event.filename || ""
  if (EXTENSION_ORIGINS.some((o) => src.startsWith(o))) return true
  // Some injected content scripts don't carry an extension URL but are clearly
  // third-party (e.g. injected as a blob: or without a filename) and throw
  // SyntaxErrors because they use ES-module syntax in a classic script context.
  if (
    event.error instanceof SyntaxError &&
    typeof event.message === "string" &&
    event.message.includes("Unexpected token") &&
    !src.startsWith(window.location.origin) &&
    !src.includes("/_next/")
  ) {
    return true
  }
  return false
}

export function DevErrorSuppressor() {
  // ── Production: suppress browser-extension errors ──────────────────────────
  useEffect(() => {
    const handleExtensionError = (event: ErrorEvent) => {
      if (isExtensionError(event)) {
        event.preventDefault()
        event.stopImmediatePropagation()
      }
    }
    window.addEventListener("error", handleExtensionError, true)
    return () => window.removeEventListener("error", handleExtensionError, true)
  }, [])

  // ── Development: suppress Next.js devtools pointer-capture noise ────────────
  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return

    // 1. Suppress via window error event (catches synchronous throws)
    const handleWindowError = (event: ErrorEvent) => {
      if (
        event.error instanceof DOMException &&
        event.error.name === "NotFoundError" &&
        typeof event.message === "string" &&
        event.message.includes("releasePointerCapture")
      ) {
        event.preventDefault() // prevent printing to console
        event.stopImmediatePropagation()
      }
    }
    window.addEventListener("error", handleWindowError, true)

    // 2. Patch releasePointerCapture on Element.prototype so the call
    //    inside the Next.js devtools draggable never even reaches the browser.
    const original = Element.prototype.releasePointerCapture
    Element.prototype.releasePointerCapture = function (pointerId: number) {
      try {
        original.call(this, pointerId)
      } catch (e) {
        if (e instanceof DOMException && e.name === "NotFoundError") {
          // Silently ignore – the pointer was already released by the browser.
          return
        }
        throw e
      }
    }

    return () => {
      window.removeEventListener("error", handleWindowError, true)
      Element.prototype.releasePointerCapture = original
    }
  }, [])

  return null
}
