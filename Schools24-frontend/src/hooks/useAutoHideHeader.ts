"use client"

import { RefObject, useEffect, useRef, useState } from "react"
import { usePathname } from "next/navigation"

export function useAutoHideHeader(scrollRef: RefObject<HTMLElement | null>) {
  const pathname = usePathname()
  const [isVisible, setIsVisible] = useState(true)
  const visibleRef = useRef(true)
  const lastActiveTopRef = useRef(0)
  const lastElementTopRef = useRef(0)
  const lastWindowTopRef = useRef(0)
  const activeSourceRef = useRef<"element" | "window">("element")
  const deltaThreshold = 2
  const desktopAndTvMinWidth = 1024

  const getWindowScrollTop = () => Math.max(window.scrollY, document.documentElement.scrollTop, 0)
  const isDesktopOrTvViewport = () => window.matchMedia(`(min-width: ${desktopAndTvMinWidth}px)`).matches

  const updateVisibility = (nextVisible: boolean) => {
    visibleRef.current = nextVisible
    setIsVisible((current) => (current === nextVisible ? current : nextVisible))
  }

  useEffect(() => {
    updateVisibility(true)
    lastActiveTopRef.current = 0
    lastElementTopRef.current = 0
    lastWindowTopRef.current = 0
    activeSourceRef.current = "element"
  }, [pathname])

  useEffect(() => {
    const element = scrollRef.current

    if (isDesktopOrTvViewport()) {
      updateVisibility(true)

      const handleResize = () => {
        if (isDesktopOrTvViewport()) {
          updateVisibility(true)
        }
      }

      window.addEventListener("resize", handleResize, { passive: true })
      return () => {
        window.removeEventListener("resize", handleResize)
      }
    }

    const getElementTop = () => (element ? Math.max(element.scrollTop, 0) : 0)

    const evaluateVisibility = (source: "element" | "window", nextSourceTop: number, sourceDelta: number) => {
      const elementTop = source === "element" ? nextSourceTop : getElementTop()
      const windowTop = source === "window" ? nextSourceTop : getWindowScrollTop()

      const elementIsScrollable = !!element && element.scrollHeight - element.clientHeight > 1
      const shouldPreferElement = elementIsScrollable && elementTop > 0

      if (shouldPreferElement) {
        activeSourceRef.current = "element"
      } else if (windowTop > 0) {
        activeSourceRef.current = "window"
      } else if (Math.abs(sourceDelta) >= deltaThreshold) {
        activeSourceRef.current = source
      }

      const nextActiveTop = activeSourceRef.current === "element" ? elementTop : windowTop
      if (nextActiveTop <= 0) {
        updateVisibility(true)
        lastActiveTopRef.current = 0
        return
      }

      const delta = nextActiveTop - lastActiveTopRef.current
      lastActiveTopRef.current = nextActiveTop

      if (Math.abs(delta) < deltaThreshold) {
        return
      }

      if (delta > 0) {
        if (visibleRef.current) updateVisibility(false)
      } else if (!visibleRef.current) {
        updateVisibility(true)
      }
    }

    const handleElementScroll = () => {
      const nextTop = getElementTop()
      const delta = nextTop - lastElementTopRef.current
      lastElementTopRef.current = nextTop
      evaluateVisibility("element", nextTop, delta)
    }

    const handleWindowScroll = () => {
      if (isDesktopOrTvViewport()) {
        updateVisibility(true)
        return
      }

      const nextTop = getWindowScrollTop()
      const delta = nextTop - lastWindowTopRef.current
      lastWindowTopRef.current = nextTop
      evaluateVisibility("window", nextTop, delta)
    }

    lastElementTopRef.current = getElementTop()
    lastWindowTopRef.current = getWindowScrollTop()
    activeSourceRef.current = lastElementTopRef.current > 0 ? "element" : "window"
    lastActiveTopRef.current = activeSourceRef.current === "element" ? lastElementTopRef.current : lastWindowTopRef.current

    if (element) {
      element.addEventListener("scroll", handleElementScroll, { passive: true })
    }
    window.addEventListener("scroll", handleWindowScroll, { passive: true })
    window.addEventListener("resize", handleWindowScroll, { passive: true })

    return () => {
      if (element) {
        element.removeEventListener("scroll", handleElementScroll)
      }
      window.removeEventListener("scroll", handleWindowScroll)
      window.removeEventListener("resize", handleWindowScroll)
    }
  }, [scrollRef, pathname])

  return isVisible
}
