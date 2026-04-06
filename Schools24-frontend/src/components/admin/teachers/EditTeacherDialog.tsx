"use client"

import { useState } from 'react'
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Badge } from '@/components/ui/badge'
import { Plus, X } from 'lucide-react'
import { toast } from 'sonner'
import { useAdminCatalogSubjects } from '@/hooks/useAdminCatalogSubjects'

interface Teacher {
    id: string
    name: string
    email: string
    phone: string
    employeeId: string
    department: string
    designation?: string
    qualification?: string
    qualifications?: string[]
    subjects?: string[]
    subjectIds?: string[]
    subject_ids?: string[]
    subjects_taught?: string[]
    experience: string
    experience_years?: number
    salary: number
    joinDate?: string
    hire_date?: string
}

interface EditTeacherDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    teacher: Teacher | null
    onSave: (id: string, data: TeacherUpdatePayload) => void
}

export interface TeacherUpdatePayload {
    [key: string]: unknown
    full_name: string
    email: string
    phone: string
    employee_id: string
    department: string
    designation?: string
    qualifications?: string[]
    subjects_taught: string[]
    experience_years: number
    hire_date?: string
    salary: number
}

const buildFormData = (teacher: Teacher | null) => ({
    // Professional Info
    employee_id: teacher?.employeeId || '',
    department: teacher?.department || '',
    designation: teacher?.designation || '',
    hire_date: teacher?.hire_date ? teacher.hire_date.split('T')[0] : (teacher?.joinDate ? teacher.joinDate.split('T')[0] : ''),

    // Qualifications & Subjects
    qualifications: teacher?.qualifications || (teacher?.qualification ? teacher.qualification.split(',').map(q => q.trim()).filter(Boolean) : []),
    subjects_taught: (() => {
        const fromIDs = (teacher?.subjectIds || teacher?.subject_ids || []).map((subject) => subject.trim()).filter(Boolean)
        if (fromIDs.length > 0) return fromIDs
        const fromProfile = (teacher?.subjects_taught || teacher?.subjects || []).map((subject) => subject.trim()).filter(Boolean)
        if (fromProfile.length > 0) return fromProfile
        const fallbackDepartment = (teacher?.department || '').trim()
        return fallbackDepartment ? [fallbackDepartment] : []
    })(),
    experience_years: teacher?.experience_years || parseInt(teacher?.experience || '') || 0,

    // Personal & Salary
    full_name: teacher?.name || '',
    email: teacher?.email || '',
    phone: teacher?.phone || '',
    salary: teacher?.salary || 0,
})

export function EditTeacherDialog({ open, onOpenChange, teacher, onSave }: EditTeacherDialogProps) {
    const [formData, setFormData] = useState(() => buildFormData(teacher))

    const [newQualification, setNewQualification] = useState('')
    const { data: subjectsData } = useAdminCatalogSubjects({ enabled: open })
    const departmentOptions = subjectsData?.subjects || []
    const subjectOptionById = new Map(departmentOptions.map((subject) => [subject.id, subject]))
    const subjectOptionByName = new Map(departmentOptions.map((subject) => [subject.name.toLowerCase(), subject]))
    const availableDepartmentOptions = [
        ...departmentOptions,
        ...formData.subjects_taught
            .filter((value) => !subjectOptionById.has(value))
            .map((value) => ({ id: value, name: value, code: '' })),
    ]

    const handleAddDepartment = () => {
        const firstAvailable = departmentOptions.find(
            (option) => !formData.subjects_taught.some((selected) => selected.toLowerCase() === option.id.toLowerCase())
        )
        if (!firstAvailable) {
            toast.error('No more departments available to add')
            return
        }
        setFormData((prev) => ({
            ...prev,
            subjects_taught: [...prev.subjects_taught, firstAvailable.id]
        }))
    }

    const handleDepartmentChange = (index: number, value: string) => {
        if (formData.subjects_taught.some((item, i) => i !== index && item.toLowerCase() === value.toLowerCase())) {
            toast.error('Department already selected')
            return
        }
        setFormData((prev) => {
            const next = [...prev.subjects_taught]
            next[index] = value
            return {
                ...prev,
                subjects_taught: next,
                department: index === 0 ? (subjectOptionById.get(value)?.name || value) : (subjectOptionById.get(next[0] || '')?.name || next[0] || value)
            }
        })
    }

    const handleRemoveDepartment = (index: number) => {
        setFormData((prev) => {
            const next = prev.subjects_taught.filter((_, i) => i !== index)
            return {
                ...prev,
                subjects_taught: next,
                department: subjectOptionById.get(next[0] || '')?.name || next[0] || ''
            }
        })
    }

    const handleAddQualification = () => {
        if (newQualification.trim()) {
            setFormData({
                ...formData,
                qualifications: [...formData.qualifications, newQualification.trim()]
            })
            setNewQualification('')
        }
    }

    const handleRemoveQualification = (index: number) => {
        setFormData({
            ...formData,
            qualifications: formData.qualifications.filter((_, i) => i !== index)
        })
    }

    const handleSubmit = () => {
        if (!teacher?.id) return

        // Validate mandatory fields
        if (!formData.full_name || !formData.email || !formData.employee_id) {
            toast.error('Please fill in all required fields')
            return
        }
        if (formData.subjects_taught.length === 0) {
            toast.error('Please add at least one department')
            return
        }

        const normalizedSubjectIDs = formData.subjects_taught
            .map((value) => {
                const byID = subjectOptionById.get(value)
                if (byID) return byID.id
                const byName = subjectOptionByName.get(value.toLowerCase())
                return byName ? byName.id : value
            })
            .filter(Boolean)
        const primaryDepartment = subjectOptionById.get(normalizedSubjectIDs[0])?.name
            || subjectOptionByName.get(normalizedSubjectIDs[0]?.toLowerCase() || '')?.name
            || normalizedSubjectIDs[0]

        const payload = {
            full_name: formData.full_name,
            email: formData.email,
            phone: formData.phone,
            employee_id: formData.employee_id,
            department: primaryDepartment,
            designation: formData.designation || undefined,
            qualifications: formData.qualifications.length > 0 ? formData.qualifications : undefined,
            subjects_taught: normalizedSubjectIDs,
            experience_years: formData.experience_years || 0,
            hire_date: formData.hire_date || undefined,
            salary: formData.salary || 0,
        }

        onSave(teacher.id, payload)
        onOpenChange(false)
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[700px]">
                <DialogHeader>
                    <DialogTitle>Edit Teacher Details</DialogTitle>
                    <DialogDescription>
                        Update all teacher information.
                    </DialogDescription>
                </DialogHeader>

                <Tabs defaultValue="professional" className="w-full">
                    <TabsList className="grid w-full grid-cols-3">
                        <TabsTrigger value="professional">Professional Info</TabsTrigger>
                        <TabsTrigger value="qualifications">Qualifications</TabsTrigger>
                        <TabsTrigger value="personal">Personal & Salary</TabsTrigger>
                    </TabsList>

                    {/* --- PROFESSIONAL INFO --- */}
                    <TabsContent value="professional" className="space-y-4 py-4">
                        <div className="grid grid-cols-2 gap-4">
                            <div className="grid gap-2">
                                <Label>Employee ID *</Label>
                                <Input
                                    value={formData.employee_id}
                                    disabled
                                    className="bg-muted"
                                />
                            </div>
                            <div className="grid gap-2">
                                <div className="flex items-center justify-between">
                                    <Label>Departments *</Label>
                                    <Button type="button" variant="outline" size="icon" className="h-8 w-8" onClick={handleAddDepartment}>
                                        <Plus className="h-4 w-4" />
                                    </Button>
                                </div>
                                <div className="space-y-2">
                                    {formData.subjects_taught.length === 0 ? (
                                        <p className="text-sm text-muted-foreground">Add a department using +</p>
                                    ) : null}
                                    {formData.subjects_taught.map((department, index) => (
                                        <div key={`${department}-${index}`} className="flex items-center gap-2">
                                            <Select value={department} onValueChange={(value) => handleDepartmentChange(index, value)}>
                                                <SelectTrigger>
                                                    <SelectValue placeholder="Select Department" />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    {availableDepartmentOptions.map((subjectOption) => (
                                                        <SelectItem key={subjectOption.id} value={subjectOption.id}>{subjectOption.name}</SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                            <Button
                                                type="button"
                                                variant="outline"
                                                size="icon"
                                                onClick={() => handleRemoveDepartment(index)}
                                                disabled={formData.subjects_taught.length === 1}
                                            >
                                                <X className="h-4 w-4" />
                                            </Button>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="grid gap-2">
                                <Label>Designation</Label>
                                <Input
                                    value={formData.designation}
                                    placeholder="e.g., Senior Teacher, Head of Department"
                                    onChange={(e) => setFormData({ ...formData, designation: e.target.value })}
                                />
                            </div>
                            <div className="grid gap-2">
                                <Label>Hire Date</Label>
                                <Input
                                    type="date"
                                    value={formData.hire_date}
                                    onChange={(e) => setFormData({ ...formData, hire_date: e.target.value })}
                                />
                            </div>
                        </div>
                    </TabsContent>

                    {/* --- QUALIFICATIONS & SUBJECTS --- */}
                    <TabsContent value="qualifications" className="space-y-4 py-4">
                        <div className="grid gap-2">
                            <Label>Qualifications</Label>
                            <div className="flex gap-2">
                                <Input
                                    value={newQualification}
                                    placeholder="e.g., M.Sc. Mathematics, B.Ed"
                                    onChange={(e) => setNewQualification(e.target.value)}
                                    onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddQualification())}
                                />
                                <Button type="button" onClick={handleAddQualification}>Add</Button>
                            </div>
                            <div className="flex flex-wrap gap-2 mt-2">
                                {formData.qualifications.map((qual, index) => (
                                    <Badge key={index} variant="secondary" className="px-3 py-1">
                                        {qual}
                                        <button
                                            onClick={() => handleRemoveQualification(index)}
                                            className="ml-2 hover:text-destructive"
                                        >
                                            <X className="h-3 w-3" />
                                        </button>
                                    </Badge>
                                ))}
                            </div>
                        </div>

                        <div className="grid gap-2">
                            <Label>Experience (Years)</Label>
                            <Input
                                type="number"
                                value={formData.experience_years}
                                onChange={(e) => setFormData({ ...formData, experience_years: parseInt(e.target.value) || 0 })}
                                min="0"
                            />
                        </div>
                    </TabsContent>

                    {/* --- PERSONAL & SALARY --- */}
                    <TabsContent value="personal" className="space-y-4 py-4">
                        <div className="grid grid-cols-2 gap-4">
                            <div className="grid gap-2">
                                <Label>Full Name *</Label>
                                <Input
                                    value={formData.full_name}
                                    onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
                                />
                            </div>
                            <div className="grid gap-2">
                                <Label>Email (Login) *</Label>
                                <Input
                                    type="email"
                                    value={formData.email}
                                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                                />
                            </div>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="grid gap-2">
                                <Label>Phone</Label>
                                <Input
                                    type="tel"
                                    inputMode="numeric"
                                    maxLength={10}
                                    placeholder="10-digit mobile number"
                                    value={formData.phone}
                                    onChange={(e) => setFormData({ ...formData, phone: e.target.value.replace(/\D/g, '').slice(0, 10) })}
                                />
                            </div>
                            <div className="grid gap-2">
                                <Label>Salary (₹)</Label>
                                <Input
                                    type="number"
                                    value={formData.salary}
                                    onChange={(e) => setFormData({ ...formData, salary: Number(e.target.value) })}
                                    min="0"
                                />
                            </div>
                        </div>
                    </TabsContent>
                </Tabs>

                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                        Cancel
                    </Button>
                    <Button onClick={handleSubmit}>Save Changes</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
