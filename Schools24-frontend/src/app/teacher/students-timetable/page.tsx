"use client"

import React, { useEffect, useMemo, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { FileSpreadsheet, Printer, Calendar, User, MapPin, Info } from 'lucide-react'
import { useTeacherClassTimetable, useTeacherClasses, useTeacherTimetable, useTeacherTimetableConfig } from '@/hooks/useTimetableView'
import { toast } from 'sonner'
import { collapseClassesForTimetable, compareClassLabels, formatSchoolClassLabel } from '@/lib/classOrdering'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { useClasses } from '@/hooks/useClasses'

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

const getDisplayClassLabel = (className: string) => {
    const trimmed = className.trim()
    if (!trimmed) return 'Class'
    return trimmed.toLowerCase().startsWith('class ') ? trimmed : `Class ${trimmed}`
}

const getTeacherDisplayName = (teacherName?: string | null) => {
    const trimmed = (teacherName || '').trim()
    if (!trimmed) return 'Teacher'
    return trimmed.split(' ')[0]
}

const getRoomDisplay = (roomNumber?: string | null) => {
    const trimmed = (roomNumber || '').trim()
    return trimmed ? `Room ${trimmed}` : 'Room -'
}

export default function TeacherStudentsTimetablePage() {
    const academicYear = getCurrentAcademicYear()
    const { data: configData } = useTeacherTimetableConfig()
    const { data: teacherTimetableData } = useTeacherTimetable(academicYear)
    const { data: classesData } = useTeacherClasses()
    const { data: allClassesData } = useClasses('all')
    const collapsedClasses = useMemo(
        () => collapseClassesForTimetable(allClassesData?.classes || [], academicYear),
        [allClassesData?.classes, academicYear]
    )
    const classLabelById = useMemo(() => {
        const entries: Array<[string, string]> = collapsedClasses.map((cls) => [cls.id, formatSchoolClassLabel(cls)])
        return new Map(entries)
    }, [collapsedClasses])
    const classOptions = useMemo(() => {
        const timetableClasses = new Map<string, { class_id: string; resolved_label: string }>()

        for (const entry of teacherTimetableData?.timetable || []) {
            const classId = (entry.class_id || '').trim()
            if (!classId || timetableClasses.has(classId)) continue

            timetableClasses.set(classId, {
                class_id: classId,
                resolved_label: classLabelById.get(classId) || getDisplayClassLabel(entry.class_name || ''),
            })
        }

        if (timetableClasses.size > 0) {
            return [...timetableClasses.values()].sort((a, b) => compareClassLabels(a.resolved_label, b.resolved_label))
        }

        const rows = classesData?.classes || []
        return [...rows]
            .map((row) => ({
                class_id: row.class_id,
                resolved_label: classLabelById.get(row.class_id) || getDisplayClassLabel(row.class_name),
            }))
            .sort((a, b) => compareClassLabels(a.resolved_label, b.resolved_label))
    }, [teacherTimetableData?.timetable, classesData?.classes, classLabelById])
    const [selectedClassId, setSelectedClassId] = useState('')
    const hasClasses = classOptions.length > 0
    const effectiveSelectedClassId = selectedClassId || classOptions[0]?.class_id || ''

    useEffect(() => {
        if (!classOptions.length) {
            if (selectedClassId) setSelectedClassId('')
            return
        }

        const hasSelectedClass = classOptions.some((cls) => cls.class_id === selectedClassId)
        if (!selectedClassId || !hasSelectedClass) {
            setSelectedClassId(classOptions[0].class_id)
        }
    }, [classOptions, selectedClassId])

    const { data: timetableData } = useTeacherClassTimetable(effectiveSelectedClassId, academicYear, { enabled: !!effectiveSelectedClassId })
    const timetableEntries = timetableData?.timetable || []

    const dayConfigs = useMemo(() => {
        const days = configData?.config?.days || []
        const active = days.filter(d => d.is_active).sort((a, b) => a.day_of_week - b.day_of_week)
        return active.length > 0 ? active : fallbackDays.map((d, i) => ({ day_of_week: i + 1, day_name: d, is_active: true }))
    }, [configData])

    const periodsConfig = useMemo(() => {
        return (configData?.config?.periods || []).sort((a, b) => a.period_number - b.period_number)
    }, [configData])

    // Generate time slots from periods config
    const timeSlots = useMemo(() => {
        return periodsConfig.map(p => ({
            ...p,
            display: formatTimeSlot(p.start_time, p.end_time)
        }))
    }, [periodsConfig])

    const handlePrint = () => {
        if (!effectiveSelectedClassId) return
        window.print()
        const selectedClass = classOptions.find(cls => cls.class_id === effectiveSelectedClassId)
        toast.success('Print dialog opened', { description: `Printing timetable for ${selectedClass?.resolved_label || 'Class'}` })
    }

    const handleExport = () => {
        if (!effectiveSelectedClassId) return
        const csvContent = [
            ['Time', ...dayConfigs.map(d => d.day_name)].join(','),
            ...timeSlots.map(slot =>
                [slot.display, ...dayConfigs.map(day => {
                    const entry = timetableEntries.find(t => t.day_of_week === day.day_of_week && t.period_number === slot.period_number)
                    return entry ? `${entry.subject_name || ''} - ${entry.teacher_name || ''}` : '-'
                })].join(',')
            )
        ].join('\n')
        const blob = new Blob([csvContent], { type: 'text/csv' })
        const url = window.URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        const selectedClass = classOptions.find(cls => cls.class_id === effectiveSelectedClassId)
        a.download = `timetable-${(selectedClass?.resolved_label || 'class').replace(/\s+/g, '-')}.csv`
        a.click()
        toast.success('Export completed', { description: `Timetable for ${selectedClass?.resolved_label || 'Class'} exported to CSV` })
    }

    return (
        <div className="h-[calc(100dvh-4rem)] min-h-[calc(100dvh-4rem)] flex flex-col animate-fade-in p-1 overflow-hidden">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-1 flex-shrink-0">
                <div>
                    <h1 className="text-lg sm:text-xl md:text-2xl font-bold bg-gradient-to-r from-teal-600 to-cyan-600 bg-clip-text text-transparent">Students Timetable</h1>
                    <p className="text-xs text-muted-foreground hidden sm:block">View class timetables (Read-only)</p>
                </div>
                <TooltipProvider delayDuration={200}>
                    <div className="flex flex-col sm:flex-row sm:items-center gap-1 w-full sm:w-auto">
                        <div className="flex items-center gap-1 w-full sm:w-auto">
                            <Select value={effectiveSelectedClassId} onValueChange={setSelectedClassId}>
                                <SelectTrigger className="flex-1 sm:w-[140px] md:w-[180px] h-7 sm:h-8 text-xs" disabled={!hasClasses}>
                                    <SelectValue placeholder="Select Class" />
                                </SelectTrigger>
                                <SelectContent>
                                    {classOptions.map((cls) => (
                                        <SelectItem key={cls.class_id} value={cls.class_id}>{cls.resolved_label}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Info className="h-4 w-4 text-muted-foreground cursor-help shrink-0" />
                                </TooltipTrigger>
                                <TooltipContent side="bottom" className="max-w-[220px] text-xs">
                                    Timetable periods come from the admin timetable settings. This teacher view is read-only.
                                </TooltipContent>
                            </Tooltip>
                        </div>
                        <div className="flex items-center gap-1 w-full sm:w-auto">
                            <Badge variant="outline" className="h-7 sm:h-8 px-2 text-xs flex items-center flex-1 sm:flex-none justify-center sm:justify-start">
                                <Calendar className="mr-1 h-3 w-3" />
                                {academicYear}
                            </Badge>
                            <Button variant="outline" size="sm" onClick={handlePrint} className="h-7 sm:h-8 px-2 hover:bg-teal-50 dark:hover:bg-teal-950/20 transition-all flex-1 sm:flex-none" disabled={!hasClasses}>
                                <Printer className="h-4 w-4" />
                            </Button>
                            <Button
                                size="sm"
                                onClick={handleExport}
                                className="h-7 sm:h-8 px-2 bg-gradient-to-r from-teal-500 to-cyan-600 hover:from-teal-600 hover:to-cyan-700 border-0 shadow-lg shadow-teal-500/20 flex-1 sm:flex-none"
                                disabled={!hasClasses}
                            >
                                <FileSpreadsheet className="h-4 w-4" />
                            </Button>
                        </div>
                    </div>
                </TooltipProvider>
            </div>

            {!hasClasses && (
                <Card className="border-0 shadow-lg">
                    <CardContent className="py-12 text-center text-muted-foreground">
                        <p className="text-sm font-medium">No classes assigned yet</p>
                        <p className="text-xs mt-1">Ask the admin to assign a class. This page will update after refresh.</p>
                    </CardContent>
                </Card>
            )}

            {/* Timetable Card */}
            <Card className="border-0 shadow-lg flex-1 flex flex-col overflow-hidden min-h-0" style={{ opacity: hasClasses ? 1 : 0.5 }}>
                <CardContent className="flex-1 p-0 overflow-auto">
                    <div
                        className="h-full grid"
                        style={{
                            gridTemplateColumns: `minmax(112px, 136px) repeat(${periodsConfig.length}, minmax(220px, 1fr))`,
                            gridTemplateRows: `minmax(68px, 68px) repeat(${dayConfigs.length}, minmax(132px, 1fr))`,
                            minWidth: `${112 + periodsConfig.length * 220}px`
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
                                    const timetableEntry = timetableEntries.find(
                                        t => t.day_of_week === day.day_of_week && t.period_number === slot.period_number
                                    )

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
                                            {timetableEntry ? (
                                                <div className={`w-full h-full rounded bg-gradient-to-br ${getSubjectColor(timetableEntry.subject_name || '')} text-white flex flex-col items-center justify-center p-0.5 shadow-sm`}>
                                                    <p className="font-bold truncate w-full text-center drop-shadow-sm" style={{ fontSize: 'clamp(6px, 1.2vw, 13px)' }}>{timetableEntry.subject_name}</p>
                                                    <div className="hidden lg:flex items-center justify-center gap-0.5 opacity-90 font-medium w-full" style={{ fontSize: 'clamp(6px, 0.9vw, 10px)' }}>
                                                        <div className="flex items-center gap-0.5 truncate">
                                                            <User className="h-2 w-2" />
                                                            <span className="truncate">{getTeacherDisplayName(timetableEntry.teacher_name)}</span>
                                                        </div>
                                                        <span className="opacity-60">|</span>
                                                        <div className="flex items-center gap-0.5">
                                                            <MapPin className="h-2 w-2" />
                                                            <span>{getRoomDisplay(timetableEntry.room_number)}</span>
                                                        </div>
                                                    </div>
                                                </div>
                                            ) : (
                                                <span className="text-muted-foreground" style={{ fontSize: 'clamp(6px, 1vw, 11px)' }}>-</span>
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
