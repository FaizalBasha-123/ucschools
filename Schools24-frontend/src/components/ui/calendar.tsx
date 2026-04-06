"use client"

import * as React from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { DayPicker, getDefaultClassNames } from "react-day-picker"
import { cn } from "@/lib/utils"
import { buttonVariants } from "@/components/ui/button"

export type CalendarProps = React.ComponentProps<typeof DayPicker>

function Calendar({
    className,
    classNames,
    showOutsideDays = true,
    ...props
}: CalendarProps) {
    const defaultClassNames = getDefaultClassNames()

    return (
        <DayPicker
            showOutsideDays={showOutsideDays}
            className={cn("p-3", className)}
            classNames={{
                // Root container
                root: cn(defaultClassNames.root, "w-full"),

                // Month layout - this needs relative to contain the nav
                months: cn(defaultClassNames.months, "flex flex-col gap-4 relative"),
                month: cn(defaultClassNames.month, "flex flex-col gap-2"),

                // Caption (header with month/year) - centered with padding for nav buttons
                month_caption: cn(defaultClassNames.month_caption, "flex items-center justify-center h-10 px-10"),
                caption_label: cn(defaultClassNames.caption_label, "text-base font-semibold"),

                // Navigation - positioned within months container
                nav: cn(defaultClassNames.nav, "absolute top-0 left-0 right-0 h-10 flex items-center justify-between px-1"),
                button_previous: cn(
                    buttonVariants({ variant: "outline" }),
                    "h-8 w-8 bg-transparent p-0 opacity-70 hover:opacity-100 z-10"
                ),
                button_next: cn(
                    buttonVariants({ variant: "outline" }),
                    "h-8 w-8 bg-transparent p-0 opacity-70 hover:opacity-100 z-10"
                ),

                // Month grid (table)
                month_grid: cn(defaultClassNames.month_grid, "w-full border-collapse"),

                // Weekday headers
                weekdays: cn(defaultClassNames.weekdays, "flex w-full"),
                weekday: cn(
                    defaultClassNames.weekday,
                    "text-muted-foreground rounded-md flex-1 font-medium text-[0.8rem] flex items-center justify-center h-10"
                ),

                // Week rows
                week: cn(defaultClassNames.week, "flex w-full"),

                // Day cells
                day: cn(
                    defaultClassNames.day,
                    "flex-1 h-10 text-center text-sm p-0 relative flex items-center justify-center [&:has([aria-selected].range_end)]:rounded-r-md [&:has([aria-selected].outside)]:bg-accent/50 [&:has([aria-selected])]:bg-accent first:[&:has([aria-selected])]:rounded-l-md last:[&:has([aria-selected])]:rounded-r-md focus-within:relative focus-within:z-20"
                ),

                // Day button (the clickable day)
                day_button: cn(
                    buttonVariants({ variant: "ghost" }),
                    "h-9 w-9 p-0 font-normal aria-selected:opacity-100 rounded-md"
                ),

                // Day states
                range_end: "range_end",
                selected: "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground focus:bg-primary focus:text-primary-foreground rounded-md",
                today: "bg-accent text-accent-foreground font-semibold rounded-md",
                outside: "outside text-muted-foreground/50 aria-selected:bg-accent/50 aria-selected:text-muted-foreground",
                disabled: "text-muted-foreground opacity-50",
                range_middle: "aria-selected:bg-accent aria-selected:text-accent-foreground",
                hidden: "invisible",

                // Chevron icon
                chevron: cn(defaultClassNames.chevron, "h-4 w-4"),

                ...classNames,
            }}
            {...props}
        />
    )
}
Calendar.displayName = "Calendar"

export { Calendar }
