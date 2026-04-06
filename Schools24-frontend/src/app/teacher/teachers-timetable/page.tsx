"use client"

import React, { useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { FileSpreadsheet, Printer, Calendar, User, MapPin, Info } from 'lucide-react'
import { useTeacherClasses, useTeacherTimetable, useTeacherTimetableConfig } from '@/hooks/useTimetableView'
import { toast } from 'sonner'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { useClasses } from '@/hooks/useClasses'
import { collapseClassesForTimetable, formatSchoolClassLabel } from '@/lib/classOrdering'

const fallbackDays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

const getCurrentAcademicYear = () => {
    const now = new Date()
    const year = now.getFullYear()
    const month = now.getMonth() + 1
    if (month < 4) {
        return `${year - 1}-${year}`
    }
    return `${year}-${year + 1}`
}

const getSubjectColor = (subject: string) => {
    const colors: { [key: string]: string } = {
        'Mathematics': 'from-blue-500 to-cyan-500',
        'Physics': 'from-violet-500 to-purple-500',
        'Chemistry': 'from-green-500 to-emerald-500',
        'English': 'from-orange-500 to-amber-500',
        'Hindi': 'from-pink-500 to-rose-500',
        'History': 'from-red-500 to-rose-500',
        'Geography': 'from-teal-500 to-cyan-500',
        'Computer Science': 'from-slate-500 to-gray-500',
        'Physical Education': 'from-lime-500 to-green-500',
        'Biology': 'from-emerald-500 to-green-500',
        'Science': 'from-green-500 to-emerald-500',
    }
    return colors[subject] || 'from-gray-500 to-slate-500'
}

const formatTime = (time: string) => {
    const [hours, minutes] = time.split(':')
    const h = parseInt(hours)
    const h12 = h > 12 ? h - 12 : h === 0 ? 12 : h
    return `${h12.toString().padStart(2, '0')}:${minutes}`
}

const formatTimeSlot = (startTime: string, endTime: string) => {
    return `${formatTime(startTime)} - ${formatTime(endTime)}`
}

const getDisplayClassLabel = (className?: string | null) => {
    const trimmed = (className || '').trim()
    if (!trimmed) return 'Class'
    return trimmed.toLowerCase().startsWith('class ') ? trimmed : `Class ${trimmed}`
}

const getRoomDisplay = (roomNumber?: string | null) => {
    const trimmed = (roomNumber || '').trim()
    return trimmed ? `Room ${trimmed}` : 'Room -'
}

const getResolvedClassLabel = (
    entry: { class_id?: string | null; class_name?: string | null },
    teacherClassLabelById: Map<string, string>,
    classLabelById: Map<string, string>
) => {
    const classId = (entry.class_id || '').trim()
    if (classId) {
        if (teacherClassLabelById.has(classId)) return teacherClassLabelById.get(classId) || 'Class'
        if (classLabelById.has(classId)) return classLabelById.get(classId) || 'Class'
    }
    return getDisplayClassLabel(entry.class_name)
}

export default function TeachersTimetablePage() {
    const academicYear = getCurrentAcademicYear()
    const { data: configData } = useTeacherTimetableConfig()
    const { data: timetableData } = useTeacherTimetable(academicYear)
    const { data: teacherClassesData } = useTeacherClasses()
    const { data: allClassesData } = useClasses('all')
    const collapsedClasses = useMemo(
        () => collapseClassesForTimetable(allClassesData?.classes || [], academicYear),
        [allClassesData?.classes, academicYear]
    )
    const classLabelById = useMemo(() => {
        const entries: Array<[string, string]> = collapsedClasses.map((cls) => [cls.id, formatSchoolClassLabel(cls)])
        return new Map(entries)
    }, [collapsedClasses])
    const teacherClassLabelById = useMemo(() => {
        const entries: Array<[string, string]> = (teacherClassesData?.classes || []).map((row) => [
            row.class_id,
            classLabelById.get(row.class_id) || getDisplayClassLabel(row.class_name),
        ])
        return new Map(entries)
    }, [teacherClassesData?.classes, classLabelById])

    const dayConfigs = useMemo(() => {
        const days = configData?.config?.days || []
        const active = days.filter(d => d.is_active).sort((a, b) => a.day_of_week - b.day_of_week)
        return active.length > 0 ? active : fallbackDays.map((d, i) => ({ day_of_week: i + 1, day_name: d, is_active: true }))
    }, [configData])

    const periodsConfig = useMemo(() => {
        return (configData?.config?.periods || []).sort((a, b) => a.period_number - b.period_number)
    }, [configData])

    const timetableEntries = timetableData?.timetable || []

    // Generate time slots from periods config
    const timeSlots = useMemo(() => {
        return periodsConfig.map(p => ({
            ...p,
            display: formatTimeSlot(p.start_time, p.end_time)
        }))
    }, [periodsConfig])

    const handlePrint = () => {
        toast.success('Preparing print view...', {
            description: 'Your timetable will open in print dialog.',
        })
        setTimeout(() => window.print(), 500)
    }

    const handleExport = () => {
        toast.success('Downloading timetable...', {
            description: 'Your timetable will be downloaded shortly.',
        })
    }

    return (
        <div className="h-[calc(100dvh-4rem)] min-h-[calc(100dvh-4rem)] flex flex-col animate-fade-in p-1 overflow-hidden">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-1 flex-shrink-0">
                <div>
                    <h1 className="text-lg sm:text-xl md:text-2xl font-bold bg-gradient-to-r from-green-600 to-emerald-600 bg-clip-text text-transparent">My Timetable</h1>
                    <p className="text-xs text-muted-foreground hidden sm:block">Your teaching schedule</p>
                </div>
                <TooltipProvider delayDuration={200}>
                    <div className="flex flex-col sm:flex-row sm:items-center gap-1 w-full sm:w-auto">
                        <div className="flex items-center gap-1 w-full sm:w-auto">
                            <Badge variant="outline" className="h-7 sm:h-8 px-2 text-xs flex items-center flex-1 sm:flex-none justify-center sm:justify-start">
                                <Calendar className="mr-1 h-3 w-3" />
                                {academicYear}
                            </Badge>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Info className="h-4 w-4 text-muted-foreground cursor-help shrink-0" />
                                </TooltipTrigger>
                                <TooltipContent side="bottom" className="max-w-[220px] text-xs">
                                    This view mirrors the school timetable settings and shows your assigned classes in read-only mode.
                                </TooltipContent>
                            </Tooltip>
                        </div>
                        <div className="flex items-center gap-1 w-full sm:w-auto">
                            <Button variant="outline" size="sm" onClick={handlePrint} className="h-7 sm:h-8 px-2 hover:bg-green-50 dark:hover:bg-green-950/20 transition-all flex-1 sm:flex-none">
                                <Printer className="h-4 w-4" />
                            </Button>
                            <Button
                                size="sm"
                                onClick={handleExport}
                                className="h-7 sm:h-8 px-2 bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 border-0 shadow-lg shadow-green-500/20 flex-1 sm:flex-none"
                            >
                                <FileSpreadsheet className="h-4 w-4" />
                            </Button>
                        </div>
                    </div>
                </TooltipProvider>
            </div>

            {/* Timetable Card */}
            <Card className="border-0 shadow-lg flex-1 flex flex-col overflow-hidden min-h-0">
                <CardContent className="flex-1 p-0 overflow-x-auto overflow-y-hidden">
                    <div
                        className="h-full grid"
                        style={{
                            gridTemplateColumns: `minmax(96px, 120px) repeat(${periodsConfig.length}, minmax(170px, 1fr))`,
                            gridTemplateRows: `minmax(56px, 56px) repeat(${dayConfigs.length}, minmax(96px, 1fr))`,
                            minWidth: `${96 + periodsConfig.length * 170}px`
                        }}
                    >
                        {/* Header Row */}
                        <div className="border bg-muted flex items-center justify-center font-bold" style={{ fontSize: 'clamp(8px, 1.5vw, 14px)' }}>Day</div>
                        {timeSlots.map((slot, index) => (
                            <div key={`header-${index}`} className="border bg-muted flex flex-col items-center justify-center text-center p-0.5">
                                <div className="font-bold" style={{ fontSize: 'clamp(8px, 1.5vw, 14px)' }}>P{index + 1}</div>
                                <div className="text-muted-foreground hidden lg:block" style={{ fontSize: 'clamp(7px, 1vw, 11px)' }}>{slot.display}</div>
                                {slot.is_break && <Badge variant="outline" className="mt-0.5 px-0.5 hidden sm:inline-flex" style={{ fontSize: 'clamp(6px, 0.8vw, 9px)' }}>{slot.break_name || 'Break'}</Badge>}
                            </div>
                        ))}

                        {/* Data Rows */}
                        {dayConfigs.map((day) => (
                            <React.Fragment key={day.day_of_week}>
                                <div className="border bg-muted/50 flex items-center justify-center font-bold" style={{ fontSize: 'clamp(7px, 1.3vw, 13px)' }}>
                                    <span className="sm:hidden">{day.day_name.slice(0, 2)}</span>
                                    <span className="hidden sm:inline md:hidden">{day.day_name.slice(0, 3)}</span>
                                    <span className="hidden md:inline">{day.day_name}</span>
                                </div>
                                {timeSlots.map((slot, index) => {
                                    const entry = timetableEntries.find(t => t.day_of_week === day.day_of_week && t.period_number === slot.period_number)

                                    if (slot.is_break) return (
                                        <div key={`${day.day_of_week}-${index}`} className="border bg-gradient-to-r from-green-50 to-emerald-50 dark:from-green-950/50 dark:to-emerald-950/50 flex items-center justify-center">
                                            <div className="text-center">
                                                <span className="hidden sm:inline" style={{ fontSize: 'clamp(12px, 2vw, 24px)' }}>🍽️</span>
                                                <p className="text-green-600 dark:text-green-400 font-bold" style={{ fontSize: 'clamp(6px, 1vw, 11px)' }}>{slot.break_name || 'BREAK'}</p>
                                            </div>
                                        </div>
                                    )

                                    return (
                                        <div key={`${day.day_of_week}-${index}`} className="border p-0.5 flex items-center justify-center">
                                            {entry ? (
                                                <div className={`w-full h-full rounded bg-gradient-to-br ${getSubjectColor(entry.subject_name || '')} text-white flex flex-col items-center justify-center p-0.5 shadow-sm`}>
                                                    <p className="font-bold truncate w-full text-center drop-shadow-sm" style={{ fontSize: 'clamp(6px, 1.2vw, 13px)' }}>{entry.subject_name}</p>
                                                    <div className="hidden lg:flex items-center justify-center gap-0.5 opacity-90 font-medium w-full" style={{ fontSize: 'clamp(6px, 0.9vw, 10px)' }}>
                                                        <div className="flex items-center gap-0.5 truncate">
                                                            <User className="h-2 w-2" />
                                                            <span>{getResolvedClassLabel(entry, teacherClassLabelById, classLabelById)}</span>
                                                        </div>
                                                        <span className="opacity-60">|</span>
                                                        <div className="flex items-center gap-0.5">
                                                            <MapPin className="h-2 w-2" />
                                                            <span>{getRoomDisplay(entry.room_number)}</span>
                                                        </div>
                                                    </div>
                                                </div>
                                            ) : (
                                                <Badge variant="secondary" className="px-0.5" style={{ fontSize: 'clamp(6px, 0.9vw, 9px)' }}>Free</Badge>
                                            )}
                                        </div>
                                    )
                                })}
                            </React.Fragment>
                        ))}
                    </div>
                </CardContent>
            </Card>
        </div>
    )
}
