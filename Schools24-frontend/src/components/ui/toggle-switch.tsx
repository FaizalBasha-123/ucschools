"use client"

import * as React from "react"
import { cn } from "@/lib/utils"

interface ToggleSwitchProps {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  disabled?: boolean
  /** "primary" uses the theme primary color; "green" uses green-500 */
  variant?: "primary" | "green"
  "aria-label"?: string
}

/**
 * Pure-CSS toggle switch (UIverse/Flowbite pattern).
 * Hidden <input type="checkbox"> + styled sibling <span> with ::after pseudo-element.
 * No Radix primitives, no data-state conflicts — renders correctly on all mobile
 * WebViews and browsers.
 *
 * Track:  h-6 (24 px) × w-11 (44 px)  →  ratio 1.83 : 1  → clearly pill-shaped
 * Thumb:  h-5 (20 px) × w-5 (20 px),  positioned at top-[2px] left-[2px]
 * Travel: 44 − 2 − 20 = 22 px available; translate-x-5 (20 px) → 2 px gap on
 *         both sides  ✓
 */
export function ToggleSwitch({
  checked,
  onCheckedChange,
  disabled,
  variant = "primary",
  "aria-label": ariaLabel,
}: ToggleSwitchProps) {
  return (
    <label
      className={cn(
        "inline-flex shrink-0 cursor-pointer select-none items-center",
        disabled && "cursor-not-allowed opacity-50",
      )}
    >
      <input
        type="checkbox"
        className="sr-only"
        checked={checked}
        onChange={(e) => !disabled && onCheckedChange(e.target.checked)}
        disabled={disabled}
        aria-label={ariaLabel}
        role="switch"
        aria-checked={checked}
      />
      <span
        className={cn(
          // Track
          "relative block h-6 w-11 shrink-0 rounded-full transition-colors duration-200 ease-out",
          // Thumb via ::after
          "after:absolute after:left-[2px] after:top-[2px]",
          "after:h-5 after:w-5 after:rounded-full after:bg-white",
          "after:shadow-[0_1px_3px_rgba(15,23,42,0.25)]",
          "after:transition-transform after:duration-200 after:ease-out after:content-['']",
          // Track color
          checked
            ? variant === "green"
              ? "bg-green-500"
              : "bg-primary"
            : "bg-input/90",
          // Thumb position
          checked ? "after:translate-x-5" : "after:translate-x-0",
        )}
      />
    </label>
  )
}
