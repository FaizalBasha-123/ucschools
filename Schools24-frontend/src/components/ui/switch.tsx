"use client"

import * as React from "react"
import { cn } from "@/lib/utils"

/**
 * Pure-CSS toggle switch — replaces the Radix-based implementation.
 *
 * The Radix version causes mobile rendering issues: on Android WebViews and
 * certain browsers the Radix JS-injected `data-state` styles conflict with
 * Tailwind JIT, causing the thumb to fill the entire track and look like a
 * bare circle.
 *
 * This version uses a hidden <input type="checkbox"> + styled <span> sibling
 * with an ::after pseudo-element (UIverse / Flowbite pattern). No third-party
 * primitives — correct on all devices.
 *
 * API is intentionally compatible with the previous shadcn Switch:
 *   checked, onCheckedChange, disabled, className, ...rest props forwarded
 *   to the hidden input so forms / aria / ref still work.
 *
 * Track : h-6 w-11 (24 × 44 px) — ratio 1.83 : 1, visually a pill
 * Thumb : h-5 w-5 (20 × 20 px) at top-[2px] left-[2px]
 * Travel: translate-x-5 (20 px) — 2 px gap on both sides ✓
 *
 * Colors come from the parent className or Tailwind data-* utilities passed
 * in via className (same as before). Default checked color is bg-primary.
 */
const Switch = React.forwardRef<
  HTMLInputElement,
  Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange" | "type" | "checked"> & {
    checked?: boolean
    onCheckedChange?: (checked: boolean) => void
    className?: string
  }
>(({ checked = false, onCheckedChange, disabled, className, ...rest }, ref) => (
  <label
    className={cn(
      "inline-flex shrink-0 cursor-pointer select-none items-center",
      disabled && "cursor-not-allowed opacity-50",
    )}
  >
    <input
      {...rest}
      ref={ref}
      type="checkbox"
      className="sr-only peer"
      checked={checked}
      disabled={disabled}
      onChange={(e) => !disabled && onCheckedChange?.(e.target.checked)}
      role="switch"
      aria-checked={checked}
    />
    {/* Track + thumb */}
    <span
      className={cn(
        // Track base
        "relative block h-6 w-11 shrink-0 rounded-full",
        "transition-colors duration-200 ease-out",
        // Thumb via ::after
        "after:absolute after:left-[2px] after:top-[2px]",
        "after:h-5 after:w-5 after:rounded-full after:bg-white",
        "after:shadow-[0_1px_3px_rgba(15,23,42,0.25)]",
        "after:transition-transform after:duration-200 after:ease-out after:content-['']",
        // Track default colors (unchanged from original)
        checked ? "bg-primary" : "bg-input/90",
        // Thumb position
        checked ? "after:translate-x-5" : "after:translate-x-0",
        // Allow caller to override track color (e.g. data-[state=checked]:bg-green-500 pattern)
        className,
      )}
    />
  </label>
))
Switch.displayName = "Switch"

export { Switch }

