"use client"

import { getSubjectColor } from '@/lib/constants'

import React, { useState, useMemo, useEffect } from 'react'
import * as XLSX from 'xlsx'
import { useSearchParams } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog'
import { FileSpreadsheet, Printer, Calendar, Plus, Edit, Trash2, Save, User, MapPin, Settings, Clock, Info } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { useAuth } from '@/contexts/AuthContext'
import { useClasses } from '@/hooks/useClasses'
import { collapseClassesForTimetable } from '@/lib/classOrdering'
import { useTeachers } from '@/hooks/useAdminTeachers'
import { useClassSubjects } from '@/hooks/useClassSubjects'
import {
    useAdminTimetableConfig,
    useUpdateTimetableConfig,
    useClassTimetable,
    useUpsertTimetableSlot,
    useDeleteTimetableSlot,
    TimetablePeriodConfig
} from '@/hooks/useAdminTimetable'
import { toast } from 'sonner'
import { api } from '@/lib/api'

const EMPTY_SUBJECTS: { id: string; global_subject_id?: string | null; name: string; code: string; description?: string | null; grade_levels?: number[]; credits?: number; is_optional?: boolean }[] = []

const getCurrentAcademicYear = () => {
    const now = new Date()
    const year = now.getFullYear()
    const month = now.getMonth() + 1
    if (month < 4) {
        return `${year - 1}-${year}`
    }
    return `${year}-${year + 1}`
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

const getDisplayClassLabel = (cls: { name?: string | null; grade?: number | null; section?: string | null }) => {
    const baseName = (cls.name || '').trim() || (typeof cls.grade === 'number' ? `Class ${cls.grade}` : 'Class')
    const section = (cls.section || '').trim()
    if (!section) return baseName

    const upperBase = baseName.toUpperCase()
    const upperSection = section.toUpperCase()
    if (upperBase.endsWith(`-${upperSection}`) || upperBase.endsWith(` ${upperSection}`)) {
        return baseName
    }
    return `${baseName}-${section}`
}

interface AdmissionSettingsResponse {
    global_academic_year: string
}

export default function StudentsTimetablePage() {
    const searchParams = useSearchParams()
    const { user, isLoading } = useAuth()
    const isSuperAdmin = user?.role === 'super_admin'
    const schoolId = searchParams.get('school_id') || undefined
    const canLoad = !!user && !isLoading && (!isSuperAdmin || !!schoolId)
    const [academicYear, setAcademicYear] = useState('')
    const settingsQuery = useQuery({
        queryKey: ['admin-admission-settings'],
        queryFn: () => api.get<AdmissionSettingsResponse>('/admin/settings/admissions'),
        enabled: canLoad,
    })
    const platformAcademicYear = (settingsQuery.data?.global_academic_year || '').trim()

    useEffect(() => {
        if (!academicYear && platformAcademicYear) {
            setAcademicYear(platformAcademicYear)
        }
    }, [academicYear, platformAcademicYear])

    useEffect(() => {
        if (!academicYear && !platformAcademicYear && !settingsQuery.isLoading) {
            setAcademicYear(getCurrentAcademicYear())
        }
    }, [academicYear, platformAcademicYear, settingsQuery.isLoading])

    const { data: classesData } = useClasses('all')
    const classOptions = useMemo(
        () => collapseClassesForTimetable(classesData?.classes || [], academicYear),
        [classesData?.classes, academicYear]
    )
    const [selectedClassId, setSelectedClassId] = useState('')
    const effectiveSelectedClassId = selectedClassId || classOptions[0]?.id || ''

    const { data: configData } = useAdminTimetableConfig(schoolId, { enabled: canLoad })
    const updateConfig = useUpdateTimetableConfig()
    const { data: classTimetableData } = useClassTimetable(effectiveSelectedClassId, academicYear, schoolId, { enabled: canLoad && !!effectiveSelectedClassId && !!academicYear })
    const upsertSlot = useUpsertTimetableSlot()
    const deleteSlot = useDeleteTimetableSlot()

    const { data: teachersData } = useTeachers('', 200, schoolId, undefined, { enabled: canLoad })
    const teachers = useMemo(() => teachersData?.pages.flatMap(page => page.teachers) || [], [teachersData])
    const { data: classSubjectsData } = useClassSubjects(effectiveSelectedClassId, { enabled: canLoad && !!effectiveSelectedClassId })
    const classSubjects = useMemo(() => classSubjectsData?.subjects || EMPTY_SUBJECTS, [classSubjectsData?.subjects])

    const [isEditDialogOpen, setIsEditDialogOpen] = useState(false)
    const [isPeriodsDialogOpen, setIsPeriodsDialogOpen] = useState(false)
    const [selectedSlot, setSelectedSlot] = useState<{ dayOfWeek: number; periodNumber: number; entryId?: string } | null>(null)
    const [formData, setFormData] = useState({
        subjectId: '',
        teacherId: '',
        room: ''
    })

    const fallbackDayConfigs = useMemo(() => ([
        { day_of_week: 1, day_name: 'Monday', is_active: true },
        { day_of_week: 2, day_name: 'Tuesday', is_active: true },
        { day_of_week: 3, day_name: 'Wednesday', is_active: true },
        { day_of_week: 4, day_name: 'Thursday', is_active: true },
        { day_of_week: 5, day_name: 'Friday', is_active: true },
        { day_of_week: 6, day_name: 'Saturday', is_active: true }
    ]), [])

    const dayConfigs = useMemo(() => {
        const days = configData?.config?.days || []
        const active = days.filter(d => d.is_active).sort((a, b) => a.day_of_week - b.day_of_week)
        return active.length > 0 ? active : fallbackDayConfigs
    }, [configData, fallbackDayConfigs])

    const periodsConfig = useMemo(() => {
        return (configData?.config?.periods || []).sort((a, b) => a.period_number - b.period_number)
    }, [configData])

    const timetableEntries = classTimetableData?.timetable || []
    const selectedClass = useMemo(() => classOptions.find(c => c.id === effectiveSelectedClassId), [classOptions, effectiveSelectedClassId])
    const selectedClassLabel = selectedClass ? getDisplayClassLabel(selectedClass) : ''
    const subjectOptions = useMemo(() => {
        return classSubjects
            .map((subject) => ({
                ...subject,
                slotSubjectId: subject.global_subject_id || subject.id,
            }))
            .filter((subject, index, arr) => arr.findIndex((candidate) => candidate.slotSubjectId === subject.slotSubjectId) === index)
    }, [classSubjects])

    // Validate selected subjectId is actually in the options list
    const effectiveSubjectId = useMemo(
        () => (subjectOptions.some((s) => s.slotSubjectId === formData.subjectId) ? formData.subjectId : ''),
        [subjectOptions, formData.subjectId]
    )

    // Filter teachers to only those who teach the selected subject.
    // Since subjectOptions now resolves to global catalog IDs, match teacher.subjectIds
    // (also global catalog UUIDs) directly. Keep name/code fallback for legacy text entries.
    const teachersForSubject = useMemo(() => {
        if (!effectiveSubjectId) return []
        const selectedSubject = subjectOptions.find((s) => s.slotSubjectId === effectiveSubjectId)
        const idLower = effectiveSubjectId.toLowerCase()
        const nameLower = selectedSubject?.name.trim().toLowerCase() ?? ''
        const codeLower = selectedSubject?.code.trim().toLowerCase() ?? ''
        return teachers.filter((teacher) => {
            // UUID-based match (subjects saved as global catalog IDs)
            if (teacher.subjectIds && teacher.subjectIds.length > 0) {
                if (teacher.subjectIds.some((sid) => sid.trim().toLowerCase() === idLower)) return true
            }
            // Fallback: name/code match (legacy entries stored as text)
            if (teacher.subjects && teacher.subjects.length > 0) {
                return teacher.subjects.some((s) => {
                    const sl = s.trim().toLowerCase()
                    return sl === nameLower || (codeLower && sl === codeLower)
                })
            }
            return false
        })
    }, [effectiveSubjectId, subjectOptions, teachers])

    const [tempConfig, setTempConfig] = useState({
        days: dayConfigs,
        periods: periodsConfig
    })

    // Generate time slots from periods config
    const timeSlots = useMemo(() => {
        return periodsConfig.map(p => ({
            ...p,
            display: formatTimeSlot(p.start_time, p.end_time)
        }))
    }, [periodsConfig])

    const handlePrint = () => {
        window.print()
        toast.success('Print dialog opened', { description: `Printing timetable for ${selectedClassLabel}` })
    }

    const handleExport = () => {
        const headers = ['Period / Day', ...dayConfigs.map(d => d.day_name)]
        const rows = timeSlots.map(slot => [
            slot.display,
            ...dayConfigs.map(day => {
                const entry = timetableEntries.find(t => t.day_of_week === day.day_of_week && t.period_number === slot.period_number)
                if (!entry) return slot.is_break ? (slot.break_name || 'BREAK') : ''
                return `${entry.subject_name || ''}${entry.teacher_name ? ` — ${entry.teacher_name}` : ''}${entry.room_number ? ` (${entry.room_number})` : ''}`
            })
        ])
        const ws = XLSX.utils.aoa_to_sheet([headers, ...rows])
        const wb = XLSX.utils.book_new()
        XLSX.utils.book_append_sheet(wb, ws, 'Timetable')
        XLSX.writeFile(wb, `timetable-${selectedClassLabel}.xlsx`)
        toast.success('Export completed', { description: `Timetable for ${selectedClassLabel} exported to XLSX` })
    }

    const handleSlotClick = (dayOfWeek: number, periodIndex: number) => {
        const period = periodsConfig[periodIndex]
        if (!period || period.is_break) return
        const entry = timetableEntries.find(t => t.day_of_week === dayOfWeek && t.period_number === period.period_number)
        setSelectedSlot({ dayOfWeek, periodNumber: period.period_number, entryId: entry?.id })
        setFormData({
            subjectId: entry?.global_subject_id || entry?.subject_id || '',
            teacherId: entry?.teacher_id || '',
            room: entry?.room_number || ''
        })
        setIsEditDialogOpen(true)
    }

    const handleSaveSlot = () => {
        if (!selectedSlot || !effectiveSelectedClassId) return
        const period = periodsConfig.find(p => p.period_number === selectedSlot.periodNumber)
        if (!period) return

        if (!effectiveSubjectId || !formData.teacherId) {
            toast.error('Please select both subject and teacher')
            return
        }

        upsertSlot.mutate({
            payload: {
                class_id: effectiveSelectedClassId,
                day_of_week: selectedSlot.dayOfWeek,
                period_number: selectedSlot.periodNumber,
                subject_id: effectiveSubjectId,
                teacher_id: formData.teacherId,
                start_time: period.start_time,
                end_time: period.end_time,
                room_number: formData.room || undefined,
                academic_year: academicYear,
            },
            schoolId,
        }, {
            onSuccess: () => {
                setIsEditDialogOpen(false)
            }
        })
    }

    const handleDeleteSlot = () => {
        if (!selectedSlot || !effectiveSelectedClassId) return
        deleteSlot.mutate({
            classId: effectiveSelectedClassId,
            dayOfWeek: selectedSlot.dayOfWeek,
            periodNumber: selectedSlot.periodNumber,
            academicYear,
            schoolId,
        }, {
            onSuccess: () => setIsEditDialogOpen(false)
        })
    }

    const openPeriodsDialog = () => {
        setTempConfig({ days: dayConfigs, periods: periodsConfig })
        setIsPeriodsDialogOpen(true)
    }

    const handlePeriodCountChange = (count: number) => {
        const newPeriods: TimetablePeriodConfig[] = []
        let currentTime = 8 * 60

        for (let i = 0; i < count; i++) {
            const periodNumber = i + 1
            const existingPeriod = tempConfig.periods.find(p => p.period_number === periodNumber)
            if (existingPeriod) {
                newPeriods.push({ ...existingPeriod, period_number: periodNumber })
            } else {
                const startHour = Math.floor(currentTime / 60)
                const startMin = currentTime % 60
                const endTime = currentTime + 45
                const endHour = Math.floor(endTime / 60)
                const endMin = endTime % 60

                newPeriods.push({
                    period_number: periodNumber,
                    start_time: `${startHour.toString().padStart(2, '0')}:${startMin.toString().padStart(2, '0')}`,
                    end_time: `${endHour.toString().padStart(2, '0')}:${endMin.toString().padStart(2, '0')}`,
                    is_break: false,
                    break_name: null,
                })
            }
            currentTime += 45
        }

        setTempConfig({ ...tempConfig, periods: newPeriods })
    }

    const handlePeriodUpdate = (index: number, field: keyof TimetablePeriodConfig, value: string | boolean) => {
        const newPeriods = [...tempConfig.periods]
        newPeriods[index] = { ...newPeriods[index], [field]: value }
        setTempConfig({ ...tempConfig, periods: newPeriods })
    }

    const toggleDayActive = (dayOfWeek: number) => {
        const newDays = tempConfig.days.map(day =>
            day.day_of_week === dayOfWeek ? { ...day, is_active: !day.is_active } : day
        )
        setTempConfig({ ...tempConfig, days: newDays })
    }
    const savePeriodsConfig = () => {
        updateConfig.mutate({
            payload: { days: tempConfig.days, periods: tempConfig.periods },
            schoolId,
        }, {
            onSuccess: () => setIsPeriodsDialogOpen(false)
        })
    }

    const selectedDayLabel = selectedSlot
        ? dayConfigs.find(d => d.day_of_week === selectedSlot.dayOfWeek)?.day_name
        : ''
    const selectedPeriodDisplay = selectedSlot
        ? timeSlots.find(p => p.period_number === selectedSlot.periodNumber)?.display
        : ''

    return (
        <div className="h-[calc(100dvh-4rem)] min-h-[calc(100dvh-4rem)] flex flex-col animate-fade-in p-1 overflow-hidden">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-1 flex-shrink-0">
                <div>
                    <h1 className="text-lg sm:text-xl md:text-2xl font-bold bg-gradient-to-r from-blue-600 to-cyan-600 bg-clip-text text-transparent">Students Timetable</h1>
                    <p className="text-xs text-muted-foreground hidden sm:block">View and manage class timetables</p>
                </div>
                <TooltipProvider delayDuration={200}>
                <div className="flex flex-col sm:flex-row sm:items-center gap-1 w-full sm:w-auto">
                    {/* Row 1 (mobile): Subjects button + Class selector + Info icon */}
                    <div className="flex items-center gap-1 w-full sm:w-auto">
                        <Select value={effectiveSelectedClassId} onValueChange={setSelectedClassId}>
                            <SelectTrigger className="flex-1 sm:w-[140px] md:w-[180px] h-7 sm:h-8 text-xs">
                                <SelectValue placeholder="Select Class" />
                            </SelectTrigger>
                            <SelectContent>
                                {classOptions.map((cls) => (
                                    <SelectItem key={cls.id} value={cls.id}>
                                        {getDisplayClassLabel(cls)}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Info className="h-4 w-4 text-muted-foreground cursor-help shrink-0" />
                            </TooltipTrigger>
                            <TooltipContent side="bottom" className="max-w-[220px] text-xs">
                                Make sure to set up classes in &ldquo;Class Management&rdquo; from the User Management page first.
                            </TooltipContent>
                        </Tooltip>
                    </div>
                    {/* Row 2 (mobile): Year badge + Settings + Print + Export */}
                    <div className="flex items-center gap-1 w-full sm:w-auto">
                        <Badge variant="outline" className="h-7 sm:h-8 px-2 text-xs flex items-center flex-1 sm:flex-none justify-center sm:justify-start">
                            <Calendar className="mr-1 h-3 w-3" />
                            {academicYear || 'Loading...'}
                        </Badge>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button variant="outline" size="sm" onClick={openPeriodsDialog} className="h-7 sm:h-8 px-2 hover:bg-blue-50 dark:hover:bg-blue-950/20 transition-all flex-1 sm:flex-none">
                                    <Settings className="h-4 w-4" />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent side="bottom" className="text-xs">Settings</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button variant="outline" size="sm" onClick={handlePrint} className="h-7 sm:h-8 px-2 hover:bg-blue-50 dark:hover:bg-blue-950/20 transition-all flex-1 sm:flex-none">
                                    <Printer className="h-4 w-4" />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent side="bottom" className="text-xs">Print</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    size="sm"
                                    onClick={handleExport}
                                    className="h-7 sm:h-8 px-2 bg-gradient-to-r from-blue-500 to-cyan-600 hover:from-blue-600 hover:to-cyan-700 border-0 shadow-lg shadow-blue-500/20 flex-1 sm:flex-none"
                                >
                                    <FileSpreadsheet className="h-4 w-4" />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent side="bottom" className="text-xs">Export XLSX</TooltipContent>
                        </Tooltip>
                    </div>
                </div>
                </TooltipProvider>
            </div>

            {/* Timetable Card */}
            <Card className="border-0 shadow-lg flex-1 flex flex-col overflow-hidden min-h-0">
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
                                        <div key={`${day.day_name}-${index}`} className="border bg-gradient-to-r from-green-50 to-emerald-50 dark:from-green-950/50 dark:to-emerald-950/50 flex items-center justify-center">
                                            <div className="text-center">
                                                <p className="text-green-600 dark:text-green-400 font-bold" style={{ fontSize: 'clamp(6px, 1vw, 11px)' }}>{slot.break_name || 'BREAK'}</p>
                                            </div>
                                        </div>
                                    )

                                    return (
                                        <div
                                            key={`${day.day_name}-${index}`}
                                            className="border p-0.5 flex items-center justify-center cursor-pointer hover:bg-muted/50 transition-all group"
                                            onClick={() => handleSlotClick(day.day_of_week, index)}
                                        >
                                            {timetableEntry ? (
                                                <div className={`w-full h-full rounded bg-gradient-to-br ${getSubjectColor(timetableEntry.subject_name || '')} text-white flex flex-col items-center justify-center p-0.5 relative shadow-sm`}>
                                                    <div className="absolute top-0 right-0 opacity-0 group-hover:opacity-100 transition-opacity">
                                                        <Edit className="h-2 w-2 md:h-3 md:w-3 text-white" />
                                                    </div>
                                                    <p className="font-bold truncate w-full text-center drop-shadow-sm" style={{ fontSize: 'clamp(6px, 1.2vw, 13px)' }}>{timetableEntry.subject_name}</p>
                                                    <div className="hidden lg:flex items-center justify-center gap-0.5 opacity-90 font-medium w-full" style={{ fontSize: 'clamp(6px, 0.9vw, 10px)' }}>
                                                        <div className="flex items-center gap-0.5 truncate">
                                                            <User className="h-2 w-2" />
                                                            <span className="truncate">{timetableEntry.teacher_name?.split(' ')[0] || ''}</span>
                                                        </div>
                                                        <span className="opacity-60">|</span>
                                                        <div className="flex items-center gap-0.5">
                                                            <MapPin className="h-2 w-2" />
                                                            <span>{timetableEntry.room_number || ''}</span>
                                                        </div>
                                                    </div>
                                                </div>
                                            ) : (
                                                <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center text-blue-500 font-medium" style={{ fontSize: 'clamp(6px, 1vw, 11px)' }}>
                                                    <Plus className="h-3 w-3" />
                                                </div>
                                            )}
                                        </div>
                                    )
                                })}
                            </React.Fragment>
                        ))}
                    </div>
                </CardContent>
            </Card>

            {/* Edit Dialog */}
            <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
                <DialogContent className="w-[95vw] sm:max-w-[640px] max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>{selectedSlot?.entryId ? 'Edit Timetable Slot' : 'Add Timetable Slot'}</DialogTitle>
                        <DialogDescription>
                            {selectedDayLabel} • {selectedPeriodDisplay}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4 py-4">
                        <div className="grid gap-2">
                            <Label>Subject</Label>
                            <Select
                                value={effectiveSubjectId}
                                onValueChange={(value) => setFormData({ ...formData, subjectId: value, teacherId: '' })}
                            >
                                <SelectTrigger className="w-full">
                                    <SelectValue placeholder="Select subject first" />
                                </SelectTrigger>
                                <SelectContent>
                                    {subjectOptions.map((subject) => (
                                        <SelectItem key={subject.slotSubjectId} value={subject.slotSubjectId}>
                                            {subject.name}{subject.code ? ` (${subject.code})` : ''}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            {subjectOptions.length === 0 && (
                                <p className="text-xs text-muted-foreground">
                                    No subjects assigned to this class in the Super Admin catalog.
                                </p>
                            )}
                        </div>
                        <div className="grid gap-2">
                            <Label className={!effectiveSubjectId ? 'text-muted-foreground' : ''}>
                                Teacher
                            </Label>
                            <Select
                                value={formData.teacherId}
                                onValueChange={(value) => setFormData({ ...formData, teacherId: value })}
                                disabled={!effectiveSubjectId}
                            >
                                <SelectTrigger className="w-full">
                                    <SelectValue placeholder={effectiveSubjectId ? 'Select teacher' : 'Select a subject first'} />
                                </SelectTrigger>
                                <SelectContent>
                                    {teachersForSubject.length === 0 ? (
                                        <div className="px-2 py-3 text-sm text-muted-foreground text-center">
                                            No teachers assigned this subject
                                        </div>
                                    ) : (
                                        teachersForSubject.map((teacher) => (
                                            <SelectItem key={teacher.id} value={teacher.id}>
                                                <div className="flex items-center gap-2">
                                                    <span>{teacher.name}</span>
                                                    <span className="text-xs text-muted-foreground">{teacher.email}</span>
                                                </div>
                                            </SelectItem>
                                        ))
                                    )}
                                </SelectContent>
                            </Select>
                            {effectiveSubjectId && teachersForSubject.length === 0 && (
                                <p className="text-xs text-muted-foreground">
                                    Assign this subject to teachers via User Management → Edit Teacher.
                                </p>
                            )}
                        </div>
                        <div className="grid gap-2">
                            <Label htmlFor="room">Room Number</Label>
                            <Input
                                id="room"
                                placeholder="e.g. 101"
                                value={formData.room}
                                onChange={(e) => setFormData({ ...formData, room: e.target.value })}
                            />
                        </div>
                    </div>
                    <DialogFooter className="gap-2 sm:gap-0">
                        {selectedSlot?.entryId && (
                            <Button
                                variant="destructive"
                                onClick={handleDeleteSlot}
                                type="button"
                                className="sm:mr-auto"
                            >
                                <Trash2 className="mr-2 h-4 w-4" />
                                Clear Slot
                            </Button>
                        )}
                        <Button variant="outline" onClick={() => setIsEditDialogOpen(false)}>
                            Cancel
                        </Button>
                        <Button onClick={handleSaveSlot}>
                            <Save className="mr-2 h-4 w-4" />
                            Save Changes
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Periods Configuration Dialog */}
            <Dialog open={isPeriodsDialogOpen} onOpenChange={setIsPeriodsDialogOpen}>
                <DialogContent className="w-[95vw] max-w-2xl max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <Clock className="h-5 w-5" />
                            Configure Periods
                        </DialogTitle>
                        <DialogDescription>
                            Set the number of periods and their timings for the timetable
                        </DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4 py-4">
                        <div className="grid gap-2">
                            <Label>Number of Periods</Label>
                            <Select
                                value={tempConfig.periods.length.toString()}
                                onValueChange={(v) => handlePeriodCountChange(parseInt(v))}
                            >
                                <SelectTrigger className="w-full">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {[2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(n => (
                                        <SelectItem key={n} value={n.toString()}>{n} Periods</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="border rounded-lg p-4 space-y-3">
                            <Label className="text-sm font-medium">Active Days (max 7)</Label>
                            <div className="grid grid-cols-2 lg:grid-cols-3 gap-2">
                                {tempConfig.days.map((day) => (
                                    <label key={day.day_of_week} className="flex items-center gap-2 text-sm">
                                        <input
                                            type="checkbox"
                                            checked={day.is_active}
                                            onChange={() => toggleDayActive(day.day_of_week)}
                                            className="h-4 w-4"
                                        />
                                        {day.day_name}
                                    </label>
                                ))}
                            </div>
                        </div>

                        <div className="border rounded-lg p-4 space-y-3 max-h-[400px] overflow-y-auto">
                            <Label className="text-sm font-medium">Period Settings</Label>
                            {tempConfig.periods.map((period, index) => (
                                <div key={index} className="grid grid-cols-12 gap-2 items-center p-2 bg-muted/50 rounded-lg">
                                    <div className="col-span-1 font-bold text-sm text-center">P{period.period_number}</div>
                                    <div className="col-span-3">
                                        <Input
                                            type="time"
                                            value={period.start_time}
                                            onChange={(e) => handlePeriodUpdate(index, 'start_time', e.target.value)}
                                            className="h-8 text-xs"
                                        />
                                    </div>
                                    <div className="col-span-1 text-center text-muted-foreground">to</div>
                                    <div className="col-span-3">
                                        <Input
                                            type="time"
                                            value={period.end_time}
                                            onChange={(e) => handlePeriodUpdate(index, 'end_time', e.target.value)}
                                            className="h-8 text-xs"
                                        />
                                    </div>
                                    <div className="col-span-2 flex items-center gap-1">
                                        <input
                                            type="checkbox"
                                            id={`break-${index}`}
                                            checked={period.is_break}
                                            onChange={(e) => handlePeriodUpdate(index, 'is_break', e.target.checked)}
                                            className="h-4 w-4"
                                        />
                                        <Label htmlFor={`break-${index}`} className="text-xs">Break</Label>
                                    </div>
                                    <div className="col-span-2">
                                        {period.is_break && (
                                            <Input
                                                placeholder="Name"
                                                value={period.break_name || ''}
                                                onChange={(e) => handlePeriodUpdate(index, 'break_name', e.target.value)}
                                                className="h-8 text-xs"
                                            />
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                    <DialogFooter className="flex-col sm:flex-row gap-2">
                        <Button className="w-full sm:w-auto" variant="outline" onClick={() => setIsPeriodsDialogOpen(false)}>
                            Cancel
                        </Button>
                        <Button onClick={savePeriodsConfig} className="w-full sm:w-auto bg-gradient-to-r from-blue-500 to-cyan-600">
                            <Save className="mr-2 h-4 w-4" />
                            Save Configuration
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

        </div>
    )
}
