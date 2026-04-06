"use client"

import { useMemo, useState } from 'react'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select'
import {
    Search,
    Edit,
    Plus,
    Minus,
    Check,
    X,
    Loader2,
} from 'lucide-react'

import { toast } from 'sonner'
import { useClasses, useCreateClass, useDeleteClass, useUpdateClass, SchoolClass } from '@/hooks/useClasses'
import { useAdminCatalogClasses } from '@/hooks/useAdminCatalogClasses'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useEffect } from 'react'

// ─── Helpers ─────────────────────────────────────────────────────────────────

const normalizeSection = (value: string) => value.trim().toUpperCase().replace(/[^A-Z]/g, '')

const sectionToNumber = (label?: string | null) => {
    if (!label) return 0
    const normalized = normalizeSection(label)
    if (!normalized) return 0
    let num = 0
    for (const char of normalized) {
        num = num * 26 + (char.charCodeAt(0) - 64)
    }
    return num
}

const numberToSection = (num: number) => {
    if (num <= 0) return ''
    let result = ''
    let n = num
    while (n > 0) {
        const rem = (n - 1) % 26
        result = String.fromCharCode(65 + rem) + result
        n = Math.floor((n - 1) / 26)
    }
    return result
}

const getNextSectionLabel = (existingLabels: string[]) => {
    let max = 0
    for (const label of existingLabels) {
        const value = sectionToNumber(label)
        if (value > max) max = value
    }
    return max === 0 ? 'A' : numberToSection(max + 1)
}

interface AdmissionSettingsResponse {
    global_academic_year?: string
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ClassManagementPage() {
    const [newClassName, setNewClassName] = useState<string | null>(null)
    const [editingSection, setEditingSection] = useState<{ id: string; value: string } | null>(null)
    const [isInchargeDialogOpen, setIsInchargeDialogOpen] = useState(false)
    const [selectedClassForIncharge, setSelectedClassForIncharge] = useState<SchoolClass | null>(null)
    const [teacherSearch, setTeacherSearch] = useState('')
    const [debouncedTeacherSearch, setDebouncedTeacherSearch] = useState('')

    useEffect(() => {
        const timer = setTimeout(() => setDebouncedTeacherSearch(teacherSearch), 300)
        return () => clearTimeout(timer)
    }, [teacherSearch])

    const settingsQuery = useQuery({
        queryKey: ['admin-admission-settings'],
        queryFn: () => api.get<AdmissionSettingsResponse>('/admin/settings/admissions'),
    })

    const platformAcademicYear = (settingsQuery.data?.global_academic_year || '').trim()

    const activeAcademicYear = platformAcademicYear

    const { data: classesData, isLoading: classesLoading } = useClasses(activeAcademicYear || undefined)
    const { data: catalogClassesData } = useAdminCatalogClasses(true)
    const createClass = useCreateClass()
    const updateClass = useUpdateClass()
    const deleteClass = useDeleteClass()

    const { data: classInchargeTeachers = [], isLoading: isClassInchargeTeachersLoading } = useQuery({
        queryKey: ['class-incharge-teachers', debouncedTeacherSearch, isInchargeDialogOpen],
        enabled: isInchargeDialogOpen,
        queryFn: async () => {
            const params = new URLSearchParams()
            if (debouncedTeacherSearch) params.append('search', debouncedTeacherSearch)
            params.append('page', '1')
            params.append('page_size', '20')
            params.append('status', 'active')
            const response = await api.get<{ teachers: Array<{ id: string; name: string; email: string; department?: string | null }> }>(
                `/admin/teachers?${params.toString()}`
            )
            return response.teachers || []
        },
        staleTime: 30 * 1000,
    })

    const classes = classesData?.classes || []
    const catalogClasses = catalogClassesData?.classes || []
    const classesByName = useMemo(() => {
        const map = new Map<string, SchoolClass[]>()
        for (const cls of classes) {
            const list = map.get(cls.name) || []
            list.push(cls)
            map.set(cls.name, list)
        }
        for (const [name, list] of map.entries()) {
            list.sort((a, b) => sectionToNumber(a.section) - sectionToNumber(b.section))
            map.set(name, list)
        }
        return map
    }, [classes])

    const availableNames = useMemo(() => {
        const existing = new Set(classes.map(c => c.name))
        return catalogClasses.map(item => item.name).filter(name => !existing.has(name))
    }, [catalogClasses, classes])

    // ─── Handlers ────────────────────────────────────────────────────────────

    const handleAddSection = (name: string) => {
        if (!activeAcademicYear) {
            toast.error('Academic year is not configured yet. Please update admission settings.')
            return
        }
        const nameClasses = classesByName.get(name) || []
        const existingLabels = nameClasses.map(c => c.section || '')
        const nextLabel = getNextSectionLabel(existingLabels)
        createClass.mutate({ name, section: nextLabel, academic_year: activeAcademicYear })
    }

    const handleRemoveSection = (cls: SchoolClass) => deleteClass.mutate(cls.id)

    const handleShorten = (name: string) => {
        const nameClasses = classesByName.get(name) || []
        if (nameClasses.length === 0) return
        deleteClass.mutate(nameClasses[nameClasses.length - 1].id)
    }

    const handleRenameSection = (cls: SchoolClass) => {
        if (!editingSection) return
        const nextValue = normalizeSection(editingSection.value)
        if (!nextValue) { toast.error('Section label is required'); return }
        updateClass.mutate({ id: cls.id, section: nextValue }, { onSuccess: () => setEditingSection(null) })
    }

    const handleAddClass = () => {
        if (newClassName === null) return
        handleAddSection(newClassName)
        setNewClassName(null)
    }

    const openInchargeDialog = (cls: SchoolClass) => {
        setSelectedClassForIncharge(cls)
        setTeacherSearch('')
        setDebouncedTeacherSearch('')
        setIsInchargeDialogOpen(true)
    }

    const handleAssignIncharge = (teacherId: string) => {
        if (!selectedClassForIncharge) return
        updateClass.mutate(
            { id: selectedClassForIncharge.id, class_teacher_id: teacherId },
            { onSuccess: () => { setIsInchargeDialogOpen(false); setSelectedClassForIncharge(null) } }
        )
    }

    const handleClearIncharge = () => {
        if (!selectedClassForIncharge) return
        updateClass.mutate(
            { id: selectedClassForIncharge.id, class_teacher_id: '' },
            { onSuccess: () => { setIsInchargeDialogOpen(false); setSelectedClassForIncharge(null) } }
        )
    }

    // ─── Render ───────────────────────────────────────────────────────────────

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-col xl:flex-row xl:items-center xl:justify-between gap-4">
                <div>
                    <h1 className="text-xl md:text-3xl font-bold">Class Management</h1>
                    <p className="text-muted-foreground">Manage classes and sections</p>
                </div>
            </div>

            <Card>
                <CardHeader>
                    <div className="flex flex-wrap items-center gap-2">
                            <Select
                                value={newClassName ?? ''}
                                onValueChange={(value) => setNewClassName(value)}
                            >
                                <SelectTrigger className="w-full sm:w-[140px]">
                                    <SelectValue placeholder="Add Class" />
                                </SelectTrigger>
                                <SelectContent>
                                    {availableNames.length === 0 && (
                                        <SelectItem value="none" disabled>No classes left</SelectItem>
                                    )}
                                    {availableNames.map(name => (
                                        <SelectItem key={name} value={name}>{name}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <Button onClick={handleAddClass} disabled={newClassName === null || createClass.isPending}>
                                <Plus className="mr-2 h-4 w-4" />
                                Add Class
                            </Button>
                        </div>
                </CardHeader>
                <CardContent>
                    <div className="space-y-4">
                        {classesLoading ? (
                            <div className="flex items-center justify-center py-12 text-muted-foreground">
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                Loading classes...
                            </div>
                        ) : classesByName.size === 0 ? (
                            <div className="rounded-lg border border-dashed p-4 md:p-8 text-center text-muted-foreground">
                                No classes found. Add a class to get started.
                            </div>
                        ) : (
                            Array.from(classesByName.entries())
                                .sort((a, b) => a[0].localeCompare(b[0]))
                                .map(([name, nameClasses]) => (
                                    <div key={name} className="rounded-lg border p-4">
                                        <div className="flex flex-col xl:flex-row xl:items-center xl:justify-between gap-3">
                                            <div>
                                                <p className="text-sm text-muted-foreground">Class</p>
                                                <p className="text-lg font-semibold">{name}</p>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    onClick={() => handleAddSection(name)}
                                                    disabled={createClass.isPending}
                                                >
                                                    <Plus className="mr-2 h-4 w-4" />
                                                    Add Section
                                                </Button>
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    onClick={() => handleShorten(name)}
                                                    disabled={deleteClass.isPending}
                                                >
                                                    <Minus className="mr-2 h-4 w-4" />
                                                    Shorten
                                                </Button>
                                            </div>
                                        </div>

                                        <div className="mt-4 flex flex-wrap gap-2">
                                            {nameClasses.map((cls) => (
                                                <div key={cls.id} className="flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2 text-sm">
                                                    {editingSection?.id === cls.id ? (
                                                        <>
                                                            <Input
                                                                value={editingSection.value}
                                                                onChange={(e) => setEditingSection({ id: cls.id, value: e.target.value })}
                                                                className="h-7 w-20"
                                                            />
                                                            <Button size="icon" variant="ghost" onClick={() => handleRenameSection(cls)} disabled={updateClass.isPending}>
                                                                <Check className="h-4 w-4" />
                                                            </Button>
                                                            <Button size="icon" variant="ghost" onClick={() => setEditingSection(null)}>
                                                                <X className="h-4 w-4" />
                                                            </Button>
                                                        </>
                                                    ) : (
                                                        <>
                                                            <span className="font-medium">{cls.section || '-'}</span>
                                                            <Button size="icon" variant="ghost" onClick={() => setEditingSection({ id: cls.id, value: cls.section || '' })}>
                                                                <Edit className="h-4 w-4" />
                                                            </Button>
                                                            <Button size="icon" variant="ghost" onClick={() => handleRemoveSection(cls)} disabled={deleteClass.isPending}>
                                                                <X className="h-4 w-4" />
                                                            </Button>
                                                            <Button
                                                                size="sm"
                                                                variant={cls.class_teacher_id ? "default" : "outline"}
                                                                onClick={() => openInchargeDialog(cls)}
                                                            >
                                                                {cls.class_teacher_name?.trim() || 'Not Assigned'}
                                                            </Button>
                                                        </>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                        <p className="mt-3 text-xs text-muted-foreground">
                                            Sections follow A, B, C... Z, AA, AB patterns. You can also type custom labels.
                                        </p>
                                    </div>
                                ))
                        )}
                    </div>
                </CardContent>
            </Card>

            {/* Incharge Assignment Dialog */}
            <Dialog
                open={isInchargeDialogOpen}
                onOpenChange={(open) => {
                    setIsInchargeDialogOpen(open)
                    if (!open) setSelectedClassForIncharge(null)
                }}
            >
                <DialogContent className="w-[95vw] sm:max-w-[560px] max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>Assign Class Incharge</DialogTitle>
                        <DialogDescription>
                            {selectedClassForIncharge
                                ? `Class ${selectedClassForIncharge.grade}${selectedClassForIncharge.section ? `-${selectedClassForIncharge.section}` : ''}`
                                : 'Select a teacher for this class'}
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-3">
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                            <Input
                                placeholder="Search teacher by name or email"
                                value={teacherSearch}
                                onChange={(e) => setTeacherSearch(e.target.value)}
                                className="pl-9"
                            />
                        </div>

                        <ScrollArea className="h-[260px] rounded-md border">
                            <div className="p-2 space-y-2">
                                {isClassInchargeTeachersLoading ? (
                                    <div className="flex items-center justify-center py-8 text-muted-foreground">
                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                        Loading teachers...
                                    </div>
                                ) : classInchargeTeachers.length === 0 ? (
                                    <div className="py-8 text-center text-sm text-muted-foreground">
                                        No teachers found.
                                    </div>
                                ) : (
                                    classInchargeTeachers.map((teacher) => (
                                        <div key={teacher.id} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-md border p-3">
                                            <div>
                                                <p className="font-medium">{teacher.name}</p>
                                                <p className="text-xs text-muted-foreground">{teacher.email}</p>
                                            </div>
                                            <Button size="sm" onClick={() => handleAssignIncharge(teacher.id)} disabled={updateClass.isPending}>
                                                Select
                                            </Button>
                                        </div>
                                    ))
                                )}
                            </div>
                        </ScrollArea>
                    </div>

                    <DialogFooter className="flex-col sm:flex-row gap-2">
                        {selectedClassForIncharge?.class_teacher_id && (
                            <Button
                                className="w-full sm:w-auto"
                                variant="outline"
                                onClick={handleClearIncharge}
                                disabled={updateClass.isPending}
                            >
                                Not Assigned
                            </Button>
                        )}
                        <Button className="w-full sm:w-auto" variant="outline" onClick={() => setIsInchargeDialogOpen(false)}>
                            Close
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}
