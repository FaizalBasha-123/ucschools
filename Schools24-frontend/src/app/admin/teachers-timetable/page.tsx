"use client"

import React, { useState, useMemo, useEffect } from 'react'
import * as XLSX from 'xlsx'
import { useSearchParams } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { FileSpreadsheet, Printer, Calendar, Edit, Trash2, Save, User, MapPin, AlertTriangle, Info } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { useAuth } from '@/contexts/AuthContext'
import { useTeachers } from '@/hooks/useAdminTeachers'
import { useAdminCatalogSubjects } from '@/hooks/useAdminCatalogSubjects'
import { collapseClassesForTimetable, formatSchoolClassLabel } from '@/lib/classOrdering'
import { useClasses } from '@/hooks/useClasses'
import {
    useAdminTimetableConfig,
    useTeacherTimetable,
    useUpsertTimetableSlot,
    useDeleteTimetableSlot,
} from '@/hooks/useAdminTimetable'
import { toast } from 'sonner'
import { api } from '@/lib/api'

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
        'Mathematics': 'from-blue-500 to-cyan-500', 'Physics': 'from-violet-500 to-purple-500',
        'Chemistry': 'from-green-500 to-emerald-500', 'English': 'from-orange-500 to-amber-500',
        'Hindi': 'from-pink-500 to-rose-500', 'History': 'from-red-500 to-rose-500',
        'Geography': 'from-teal-500 to-cyan-500', 'Computer Science': 'from-slate-500 to-gray-500',
        'Physical Education': 'from-lime-500 to-green-500', 'Biology': 'from-emerald-500 to-green-500',
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

interface AdmissionSettingsResponse {
    global_academic_year: string
}

export default function TeachersTimetablePage() {
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

    const { data: teachersData } = useTeachers('', 200, schoolId, undefined, { enabled: canLoad })
    const teachers = useMemo(() => teachersData?.pages.flatMap(page => page.teachers) || [], [teachersData])
    const [selectedTeacherId, setSelectedTeacherId] = useState('')
    const effectiveSelectedTeacherId = selectedTeacherId || teachers[0]?.id || ''

    const { data: configData } = useAdminTimetableConfig(schoolId, { enabled: canLoad })
    const dayConfigs = useMemo(() => {
        const days = configData?.config?.days || []
        const active = days.filter(d => d.is_active).sort((a, b) => a.day_of_week - b.day_of_week)
        return active.length > 0 ? active : fallbackDays.map((d, i) => ({ day_of_week: i + 1, day_name: d, is_active: true }))
    }, [configData])
    const periodsConfig = useMemo(() => (configData?.config?.periods || []).sort((a, b) => a.period_number - b.period_number), [configData])

    const { data: timetableData } = useTeacherTimetable(effectiveSelectedTeacherId, academicYear, schoolId, { enabled: canLoad && !!effectiveSelectedTeacherId && !!academicYear })
    const timetableEntries = timetableData?.timetable || []
    const conflicts = timetableData?.conflicts || []

    const { data: subjectsData } = useAdminCatalogSubjects({ enabled: canLoad })
    const subjects = subjectsData?.subjects || []
    const { data: classesData } = useClasses('all')
    const classOptions = useMemo(
        () => collapseClassesForTimetable(classesData?.classes || [], academicYear),
        [classesData?.classes, academicYear]
    )
    const classLabelById = useMemo(() => {
        const entries: Array<[string, string]> = classOptions.map((cls) => [cls.id, formatSchoolClassLabel(cls)])
        return new Map(entries)
    }, [classOptions])

    const upsertSlot = useUpsertTimetableSlot()
    const deleteSlot = useDeleteTimetableSlot()

    const [isEditDialogOpen, setIsEditDialogOpen] = useState(false)
    const [selectedSlot, setSelectedSlot] = useState<{ dayOfWeek: number; periodNumber: number; entryId?: string } | null>(null)
    const [formData, setFormData] = useState({ classId: '', subjectId: '', room: '' })

    const getEntryClassLabel = (entry: { class_id?: string | null; class_name?: string | null }) => {
        const classId = (entry.class_id || '').trim()
        if (classId && classLabelById.has(classId)) {
            return classLabelById.get(classId) || 'Class'
        }

        const className = (entry.class_name || '').trim()
        if (!className) return 'Class'
        if (/^class\s+/i.test(className)) return className
        return `Class ${className}`
    }

    // Generate time slots from periods config
    const timeSlots = useMemo(() => {
        return periodsConfig.map(p => ({
            ...p,
            display: formatTimeSlot(p.start_time, p.end_time)
        }))
    }, [periodsConfig])

    const selectedDayLabel = selectedSlot
        ? dayConfigs.find(d => d.day_of_week === selectedSlot.dayOfWeek)?.day_name
        : ''
    const selectedPeriodDisplay = selectedSlot
        ? timeSlots.find(p => p.period_number === selectedSlot.periodNumber)?.display
        : ''

    const handlePrint = () => { window.print(); toast.success('Print dialog opened') }
    const handleExport = () => {
        const selectedTeacher = teachers.find(t => t.id === effectiveSelectedTeacherId)
        const teacherName = selectedTeacher?.name || 'Teacher'
        const headers = ['Period / Day', ...dayConfigs.map(d => d.day_name)]
        const rows = timeSlots.map(slot => [
            slot.display,
            ...dayConfigs.map(day => {
                const entry = timetableEntries.find(t => t.day_of_week === day.day_of_week && t.period_number === slot.period_number)
                if (!entry) return slot.is_break ? (slot.break_name || 'BREAK') : ''
                return `${entry.subject_name || ''}${entry.class_name || entry.class_id ? ` — ${getEntryClassLabel(entry)}` : ''}${entry.room_number ? ` (${entry.room_number})` : ''}`
            })
        ])
        const ws = XLSX.utils.aoa_to_sheet([headers, ...rows])
        const wb = XLSX.utils.book_new()
        XLSX.utils.book_append_sheet(wb, ws, 'Timetable')
        XLSX.writeFile(wb, `teacher-timetable-${teacherName.replace(/\s+/g, '-')}.xlsx`)
        toast.success('Export completed', { description: `Timetable for ${teacherName} exported to XLSX` })
    }

    const handleSlotClick = (dayOfWeek: number, periodIndex: number) => {
        const period = periodsConfig[periodIndex]
        if (!period || period.is_break) return
        const entry = timetableEntries.find(t => t.day_of_week === dayOfWeek && t.period_number === period.period_number)
        setSelectedSlot({ dayOfWeek, periodNumber: period.period_number, entryId: entry?.id })
        setFormData({
            classId: entry?.class_id || '',
            subjectId: entry?.global_subject_id || entry?.subject_id || '',
            room: entry?.room_number || ''
        })
        setIsEditDialogOpen(true)
    }

    const handleSaveSlot = () => {
        if (!selectedSlot || !effectiveSelectedTeacherId) return
        const period = periodsConfig.find(p => p.period_number === selectedSlot.periodNumber)
        if (!period) return

        if (!formData.classId || !formData.subjectId) {
            toast.error('Please select class and subject')
            return
        }

        upsertSlot.mutate({
            payload: {
                class_id: formData.classId,
                day_of_week: selectedSlot.dayOfWeek,
                period_number: selectedSlot.periodNumber,
                subject_id: formData.subjectId,
                teacher_id: effectiveSelectedTeacherId,
                start_time: period.start_time,
                end_time: period.end_time,
                room_number: formData.room || undefined,
                academic_year: academicYear,
            },
            schoolId,
        }, {
            onSuccess: () => setIsEditDialogOpen(false)
        })
    }

    const handleDeleteSlot = () => {
        if (!selectedSlot || !formData.classId) return
        deleteSlot.mutate({
            classId: formData.classId,
            dayOfWeek: selectedSlot.dayOfWeek,
            periodNumber: selectedSlot.periodNumber,
            academicYear,
            schoolId,
        }, {
            onSuccess: () => setIsEditDialogOpen(false)
        })
    }

    return (
        <div className="h-[calc(100dvh-4rem)] min-h-[calc(100dvh-4rem)] flex flex-col animate-fade-in p-1 overflow-hidden">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-1 flex-shrink-0">
                <div>
                    <h1 className="text-lg sm:text-xl md:text-2xl font-bold bg-gradient-to-r from-purple-600 to-pink-600 bg-clip-text text-transparent">Teachers Timetable</h1>
                    <p className="text-xs text-muted-foreground hidden sm:block">View and manage teacher schedules</p>
                </div>
                <TooltipProvider delayDuration={200}>
                <div className="flex flex-col sm:flex-row sm:items-center gap-1 w-full sm:w-auto">
                    {/* Row 1 (mobile): Teacher selector */}
                    <div className="flex items-center gap-1 w-full sm:w-auto">
                        <Select value={effectiveSelectedTeacherId} onValueChange={setSelectedTeacherId}>
                            <SelectTrigger className="flex-1 sm:w-[140px] md:w-[200px] h-7 sm:h-8 text-xs">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {teachers.map((t) => (
                                    <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    {/* Row 2 (mobile): Year badge + Print + Export */}
                    <div className="flex items-center gap-1 w-full sm:w-auto">
                            <Badge variant="outline" className="h-7 sm:h-8 px-2 text-xs flex items-center flex-1 sm:flex-none justify-center sm:justify-start">
                            <Calendar className="mr-1 h-3 w-3" />{academicYear || 'Loading...'}
                        </Badge>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button variant="outline" size="sm" onClick={handlePrint} className="h-7 sm:h-8 px-2 hover:bg-purple-50 dark:hover:bg-purple-950/20 transition-all flex-1 sm:flex-none">
                                    <Printer className="h-4 w-4" />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent side="bottom" className="text-xs">Print</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button size="sm" onClick={handleExport} className="h-7 sm:h-8 px-2 bg-gradient-to-r from-purple-500 to-pink-600 hover:from-purple-600 hover:to-pink-700 border-0 shadow-lg shadow-purple-500/20 flex-1 sm:flex-none">
                                    <FileSpreadsheet className="h-4 w-4" />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent side="bottom" className="text-xs">Export XLSX</TooltipContent>
                        </Tooltip>
                    </div>
                </div>
                </TooltipProvider>
            </div>

            {conflicts.length > 0 && (
                <Card className="border-0 shadow-lg bg-amber-50 dark:bg-amber-950/30">
                    <CardContent className="p-4">
                        <div className="flex items-start gap-3">
                            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-500 text-white">
                                <AlertTriangle className="h-4 w-4" />
                            </div>
                            <div className="space-y-1">
                                <h3 className="font-semibold text-amber-900 dark:text-amber-200">Teacher assignment conflict</h3>
                                <p className="text-sm text-amber-800/80 dark:text-amber-200/70">
                                    This teacher is assigned to multiple classes in the same period. Review the slots below.
                                </p>
                                <div className="mt-2 space-y-2">
                                    {conflicts.map((conflict, idx) => (
                                        <div key={`${conflict.day_of_week}-${conflict.period_number}-${idx}`} className="rounded-md border border-amber-200/60 dark:border-amber-800/60 p-2 bg-white/70 dark:bg-amber-950/20">
                                            <div className="text-xs font-semibold text-amber-900 dark:text-amber-100">
                                                {conflict.day_name} • Period {conflict.period_number} • {conflict.start_time} - {conflict.end_time}
                                            </div>
                                            <div className="mt-1 flex flex-wrap gap-2 text-xs text-amber-800 dark:text-amber-200">
                                                {conflict.entries.map((entry, entryIdx) => (
                                                    <span key={`${entry.class_id}-${entryIdx}`} className="rounded bg-amber-100 dark:bg-amber-900/40 px-2 py-1">
                                                        {entry.class_name} • {entry.subject_name}{entry.room_number ? ` • Room ${entry.room_number}` : ''}
                                                    </span>
                                                ))}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            )}

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
                        <div className="border bg-muted flex items-center justify-center font-bold" style={{ fontSize: 'clamp(8px, 1.5vw, 14px)' }}>Day</div>
                        {timeSlots.map((slot, i) => (
                            <div key={`header-${i}`} className="border bg-muted flex flex-col items-center justify-center text-center p-0.5">
                                <div className="font-bold" style={{ fontSize: 'clamp(8px, 1.5vw, 14px)' }}>P{i + 1}</div>
                                <div className="text-muted-foreground hidden lg:block" style={{ fontSize: 'clamp(7px, 1vw, 11px)' }}>{slot.display}</div>
                            </div>
                        ))}
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
                                        <div key={`${day.day_name}-${index}`} className="border bg-green-50 dark:bg-green-950/50 flex items-center justify-center">
                                            <div className="text-center">
                                                <p className="text-green-600 dark:text-green-400 font-bold" style={{ fontSize: 'clamp(6px, 1vw, 11px)' }}>{slot.break_name || 'BREAK'}</p>
                                            </div>
                                        </div>
                                    )

                                    return (
                                        <div key={`${day.day_name}-${index}`} className="border p-0.5 flex items-center justify-center cursor-pointer hover:bg-muted/50 group" onClick={() => handleSlotClick(day.day_of_week, index)}>
                                            {entry ? (
                                                <div className={`w-full h-full rounded bg-gradient-to-br ${getSubjectColor(entry.subject_name || '')} text-white flex flex-col items-center justify-center p-0.5 shadow-sm`}>
                                                    <p className="font-bold truncate w-full text-center drop-shadow-sm" style={{ fontSize: 'clamp(6px, 1.2vw, 13px)' }}>{entry.subject_name}</p>
                                                    <div className="hidden lg:flex items-center justify-center gap-0.5 opacity-90 font-medium w-full" style={{ fontSize: 'clamp(6px, 0.9vw, 10px)' }}>
                                                        <div className="flex items-center gap-0.5 truncate"><User className="h-2 w-2" /><span>{getEntryClassLabel(entry)}</span></div>
                                                        <span className="opacity-60">|</span>
                                                        <div className="flex items-center gap-0.5"><MapPin className="h-2 w-2" /><span>{entry.room_number ? `Room ${entry.room_number}` : 'Room -'}</span></div>
                                                    </div>
                                                </div>
                                            ) : <Badge variant="secondary" className="px-0.5" style={{ fontSize: 'clamp(6px, 0.9vw, 9px)' }}>Free</Badge>}
                                        </div>
                                    )
                                })}
                            </React.Fragment>
                        ))}
                    </div>
                </CardContent>
            </Card>

            <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
                <DialogContent className="w-[95vw] sm:max-w-[640px] max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>{selectedSlot?.entryId ? 'Edit Slot' : 'Assign Class'}</DialogTitle>
                        <DialogDescription>{selectedDayLabel} • {selectedPeriodDisplay}</DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4 py-4">
                        <div className="grid gap-2">
                            <div className="flex items-center gap-1.5">
                                <Label>Class</Label>
                                <TooltipProvider delayDuration={100}>
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help shrink-0" />
                                        </TooltipTrigger>
                                        <TooltipContent side="top" className="max-w-[220px] text-xs">
                                            Make sure to set up classes in &ldquo;Class Management&rdquo; from the User Management page first.
                                        </TooltipContent>
                                    </Tooltip>
                                </TooltipProvider>
                            </div>
                            <Select value={formData.classId} onValueChange={(v) => setFormData({ ...formData, classId: v })}>
                                <SelectTrigger className="w-full"><SelectValue placeholder="Select Class" /></SelectTrigger>
                                <SelectContent>
                                    {classOptions.map((c) => (
                                        <SelectItem key={c.id} value={c.id}>{formatSchoolClassLabel(c)}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="grid gap-2">
                            <Label>Subject</Label>
                            <Select value={formData.subjectId} onValueChange={(v) => setFormData({ ...formData, subjectId: v })}>
                                <SelectTrigger className="w-full"><SelectValue placeholder="Select Subject" /></SelectTrigger>
                                <SelectContent>
                                    {subjects.map((subject) => (
                                        <SelectItem key={subject.id} value={subject.id}>{subject.name}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="grid gap-2"><Label>Room</Label><Input placeholder="e.g. 101" value={formData.room} onChange={(e) => setFormData({ ...formData, room: e.target.value })} /></div>
                    </div>
                    <DialogFooter className="flex-col sm:flex-row gap-2">
                        {selectedSlot?.entryId && <Button variant="destructive" onClick={handleDeleteSlot} className="w-full sm:w-auto sm:mr-auto"><Trash2 className="mr-2 h-4 w-4" />Clear</Button>}
                        <Button className="w-full sm:w-auto" variant="outline" onClick={() => setIsEditDialogOpen(false)}>Cancel</Button>
                        <Button className="w-full sm:w-auto" onClick={handleSaveSlot}><Save className="mr-2 h-4 w-4" />Save</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Periods Configuration Dialog */}
        </div>
    )
}
