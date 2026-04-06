"use client"

import { RefObject, useEffect, useState } from "react"
import { usePathname } from "next/navigation"
import { ArrowUp } from "lucide-react"
import { cn } from "@/lib/utils"

type BackToTopButtonProps = {
  scrollRef: RefObject<HTMLElement | null>
  bottomClassName?: string
}

export function BackToTopButton({
  scrollRef,
  bottomClassName = "bottom-20 md:bottom-20",
}: BackToTopButtonProps) {
  const pathname = usePathname()
  const [isVisible, setIsVisible] = useState(false)

  useEffect(() => {
    const element = scrollRef.current
    if (!element) return

    const handleScroll = () => {
      const maxScrollable = Math.max(element.scrollHeight - element.clientHeight, 0)
      if (maxScrollable <= 0) {
        setIsVisible(false)
        return
      }

      setIsVisible(element.scrollTop >= maxScrollable * 0.2)
    }

    handleScroll()
    element.addEventListener("scroll", handleScroll, { passive: true })
    return () => element.removeEventListener("scroll", handleScroll)
  }, [pathname, scrollRef])

  const scrollToTop = () => {
    scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" })
  }

  return (
    <button
      type="button"
      onClick={scrollToTop}
      aria-label="Back to top"
      className={cn(
        "fixed right-4 md:right-8 z-[9998] flex h-11 w-11 items-center justify-center rounded-full",
        "border border-slate-900/80 bg-slate-950/95 text-white shadow-lg shadow-slate-950/20 backdrop-blur-md",
        "dark:border-white/80 dark:bg-white/95 dark:text-slate-950 dark:shadow-black/30",
        "transition-all duration-300 ease-in-out",
        isVisible
          ? "pointer-events-auto translate-y-0 scale-100 opacity-100"
          : "pointer-events-none translate-y-3 scale-90 opacity-0",
        bottomClassName,
      )}
    >
      <ArrowUp className="h-4.5 w-4.5" />
    </button>
  )
}
